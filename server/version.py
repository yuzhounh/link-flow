APP_NAME = "LinkFlow"
VERSION = "0.2.2"

# Keep the default below the size where a single buffered request could exhaust
# a typical desktop process. Tornado enforces this at the HTTP connection layer.
MAX_UPLOAD_BYTES = 256 * 1024 * 1024
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 2 * 1024 * 1024
