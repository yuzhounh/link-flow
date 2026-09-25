import os
from typing import Optional

def generate_thumbnail(file_path: str, thumb_dir: str, mime_type: str) -> Optional[str]:
    """
    Compatibility shim for older callers.

    LinkFlow v0.2 stores every upload as a regular file and intentionally does
    not generate previews, so Pillow and PyMuPDF are no longer runtime
    dependencies.
    """
    if not os.path.exists(file_path):
        return None
    return None
