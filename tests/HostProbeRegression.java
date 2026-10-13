package com.yuzhounh.linkflow;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Run with HostProbe.java using javac/java; no Android or real user host needed. */
public final class HostProbeRegression {
    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        ExecutorService workers = Executors.newCachedThreadPool();
        server.setExecutor(workers);
        AtomicInteger leaked = new AtomicInteger();
        CountDownLatch waiting = new CountDownLatch(1);
        server.createContext("/ok", request -> {
            byte[] body = "{\"status\":\"ok\",\"host_name\":\"test\",\"version\":\"0.3.18\"}".getBytes();
            int status = "test-token".equals(request.getRequestHeaders().getFirst("X-LinkFlow-Token")) ? 200 : 401;
            request.sendResponseHeaders(status, body.length);
            request.getResponseBody().write(body); request.close();
        });
        server.createContext("/redirect", request -> {
            request.getResponseHeaders().set("Location", "/sink");
            request.sendResponseHeaders(302, -1); request.close();
        });
        server.createContext("/sink", request -> {
            leaked.incrementAndGet(); request.sendResponseHeaders(200, -1); request.close();
        });
        server.createContext("/stall", request -> {
            try { Thread.sleep(8000); } catch (InterruptedException ignored) { }
            request.close();
        });
        server.createContext("/cancel", request -> {
            waiting.countDown();
            try { Thread.sleep(8000); } catch (InterruptedException ignored) { }
            request.close();
        });
        server.start();
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        try {
            HostProbe.Result ok = new HostProbe().run(base + "/ok", "test-token");
            require(ok.status == 200 && ok.body.contains("host_name"), "authenticated response");
            require(new HostProbe().run(base + "/ok", "wrong").status == 401, "expired token status");
            require(new HostProbe().run(base + "/redirect", "test-token").status == 302 && leaked.get() == 0, "redirect cannot leak token");
            long started = System.nanoTime();
            require(new HostProbe().run(base + "/stall", "test-token").status == 0, "unresponsive service fails");
            require(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started) < 3500, "read timeout is bounded");
            HostProbe cancelled = new HostProbe();
            Future<HostProbe.Result> pending = workers.submit(() -> cancelled.run(base + "/cancel", "test-token"));
            require(waiting.await(1, TimeUnit.SECONDS), "request reached fixture");
            cancelled.cancel();
            require(pending.get(3, TimeUnit.SECONDS).status == 0, "cancelled request cannot succeed");
            HostProbe beforeStart = new HostProbe(); beforeStart.cancel();
            require(beforeStart.run(base + "/sink", "test-token").status == 0 && leaked.get() == 0, "cancel before start sends nothing");
            System.out.println("PASS: authenticated probe, expired token, no redirect, read timeout and cancellation");
        } finally { server.stop(0); workers.shutdownNow(); }
    }
    private static void require(boolean valid, String message) {
        if (!valid) throw new AssertionError(message);
    }
}
