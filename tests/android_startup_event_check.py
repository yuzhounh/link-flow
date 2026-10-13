"""Emulator-only startup event regression; prerequisites are in review/android_startup_review.md."""
import hashlib, json, pathlib, re, socket, subprocess, sys, time, xml.etree.ElementTree as ET
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'android/app/build/startup-evidence'
OUT.mkdir(exist_ok=True)
PKG = 'com.yuzhounh.linkflow.startupcheck'
def adb(*args, binary=False):
    r = subprocess.run(['adb','-s','emulator-5554',*args],check=True,capture_output=True)
    return r.stdout if binary else r.stdout.decode('utf-8',errors='replace')
def launch():
    adb('shell','am','force-stop',PKG)
    prefs = OUT/'pairing.xml'
    prefs.write_text('<?xml version="1.0"?><map><string name="pairingUrl">http://10.0.2.2:18039/?token=test-pairing-token-0123456789abcdef</string></map>')
    adb('push',str(prefs),'/data/local/tmp/lf-startup-pairing.xml')
    adb('shell','run-as',PKG,'mkdir','-p','shared_prefs')
    adb('shell','run-as',PKG,'cp','/data/local/tmp/lf-startup-pairing.xml','shared_prefs/com.yuzhounh.linkflow.MainActivity.xml')
    print(adb('shell','am','start','-W','-n',PKG+'/com.yuzhounh.linkflow.MainActivity'),flush=True)
def screenshot(name):
    (OUT/(name+'.png')).write_bytes(adb('exec-out','screencap','-p',binary=True))
def expect(text):
    adb('shell','uiautomator','dump','/sdcard/lf-event.xml')
    t=ET.fromstring(adb('shell','cat','/sdcard/lf-event.xml'))
    assert any(text in n.get('text','') for n in t.iter('node')),text
    print('PASS:',text,flush=True)
    return t
fixture=None
try:
    launch(); time.sleep(5)
    expect('暂时无法连接电脑')
    if '--exact' not in sys.argv:
        # Same address and identifier, but an invalid fresh proof must not connect.
        host=hashlib.sha256(b'test-pairing-token-0123456789abcdef').hexdigest()[:32]; boot='a'*32
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as attacker:
            attacker.bind(('127.0.0.1',5840)); attacker.settimeout(3)
            attacker.sendto(json.dumps(dict(type='lf-online-v1',host=host,boot=boot)).encode(),('127.0.0.1',15839))
            challenge,peer=attacker.recvfrom(2048); nonce=json.loads(challenge)['nonce']
            attacker.sendto(json.dumps(dict(type='lf-ready-v1',host=host,boot=boot,nonce=nonce,port=18039,signature='0'*64)).encode(),peer)
        time.sleep(0.5); expect('暂时无法连接电脑')
        print('PASS: invalid startup signature ignored',flush=True)
        launch(); time.sleep(0.4); adb('shell','input','keyevent','4'); time.sleep(4.5)
        cancelled=expect('已取消连接')
    fixture=subprocess.Popen(['dotnet',str(ROOT/'tests/AndroidStartupFixture/bin/Release/net10.0-windows/AndroidStartupFixture.dll'),str(ROOT/'android/app/build/startup-fixture'),str(ROOT/'static')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8')
    line=fixture.stdout.readline().strip(); assert line.startswith('STARTUP FIXTURE READY'),line
    port=int(line.split()[-1]); print(line,flush=True)
    def command(value):
        fixture.stdin.write(value+'\n'); fixture.stdin.flush()
        return fixture.stdout.readline().strip()
    if '--exact' not in sys.argv:
        assert command('announce')=='STARTUP EVENT SENT'
        time.sleep(1); assert command('clients')=='CLIENTS 0'
        expect('已取消连接'); print('PASS: cancellation suppresses automatic connection',flush=True)
        node=next(n for n in cancelled.iter('node') if n.get('text')=='重试连接')
        x1,y1,x2,y2=map(int,re.findall(r'\d+',node.get('bounds')))
        adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2)); time.sleep(0.5)
    started=time.monotonic(); assert command('announce')=='STARTUP EVENT SENT'
    count=command('clients-wait'); print(count,flush=True)
    assert count=='CLIENTS 1','Phone did not open the authenticated WebSocket'
    connected_at=time.monotonic()-started
    time.sleep(0.5)
    prefs=adb('shell','run-as',PKG,'cat','shared_prefs/com.yuzhounh.linkflow.MainActivity.xml')
    assert f':{port}/' in prefs,'Verified new HTTP port was not saved'
    screenshot('automatic-online')
    print('PASS: PC startup event automatically connected foreground phone in',round(connected_at,2),'seconds',flush=True)
finally:
    if fixture:
        fixture.stdin.write('stop\n'); fixture.stdin.flush(); fixture.wait(timeout=10)
    adb('shell','am','force-stop',PKG)
