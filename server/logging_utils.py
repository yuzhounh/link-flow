import logging
import os
import sys
from logging.handlers import RotatingFileHandler


LOG_FILENAME = "linkflow.log"


def configure_logging(data_dir: str) -> str:
    """Configure console logging plus a bounded persistent log for pythonw mode."""
    os.makedirs(data_dir, exist_ok=True)
    log_path = os.path.join(os.path.abspath(data_dir), LOG_FILENAME)
    root = logging.getLogger()
    root.setLevel(logging.INFO)

    for handler in list(root.handlers):
        if getattr(handler, "_linkflow_managed", False):
            root.removeHandler(handler)
            handler.close()

    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = RotatingFileHandler(
        log_path,
        maxBytes=2 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler._linkflow_managed = True
    root.addHandler(file_handler)

    if sys.stderr is not None and getattr(sys.stderr, "name", "") != os.devnull:
        console_handler = logging.StreamHandler(sys.stderr)
        console_handler.setFormatter(formatter)
        console_handler._linkflow_managed = True
        root.addHandler(console_handler)

    return log_path
