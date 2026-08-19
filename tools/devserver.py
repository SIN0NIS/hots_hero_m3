"""hots_hero_each 를 캐시 없이 띄우는 서버 (hots_hero/tools/devserver.py 와 같은 이유).

  python tools/devserver.py [포트]
"""
import functools
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass                                   # 조용히

    def do_POST(self):
        """파일 업로드 두 갈래.

        /_shot/<이름>.png  검증용 스크린샷 -> _verify/
        /_out/<이름>.jpg   확인용 4방향 미리보기 -> preview_format/ (한글 허용)
        """
        import re
        import urllib.parse
        path = urllib.parse.unquote(self.path)
        m = re.fullmatch(r"/_shot/([A-Za-z0-9_.-]{1,80}\.(?:png|jpg))", path)
        m2 = re.fullmatch(
            r"/_out/([\w가-힣()' .·—-]{1,120}\.(?:png|jpg|json))", path)
        if not m and not m2:
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length", 0))
        if not 0 < n <= 30 * 1024 * 1024:
            self.send_error(413)
            return
        body = self.rfile.read(n)
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if m:
            vdir, name = os.path.join(root, "_verify"), m.group(1)
        else:
            vdir, name = os.path.join(root, "preview_format"), m2.group(1)
        os.makedirs(vdir, exist_ok=True)
        with open(os.path.join(vdir, name), "wb") as f:
            f.write(body)
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8793
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCache, directory=root)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    print("http://localhost:%d  (캐시 끔, %s)" % (port, root))
    srv.serve_forever()


if __name__ == "__main__":
    main()
