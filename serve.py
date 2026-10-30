"""Servidor local do jogo.

    python serve.py           -> http://localhost:8831 (PC, painel de visualização)
    python serve.py --https   -> https://<IP do PC>:8443 (para abrir no navegador do Quest)

O modo HTTPS cria na primeira vez um certificado próprio em certs/ (usa o OpenSSL que vem
com o Git). O Quest vai avisar que a conexão não é segura: é o seu próprio PC, pode aceitar.
Os arquivos são servidos sem cache, para o navegador sempre pegar a versão nova.
"""
import argparse
import http.server
import os
import shutil
import socket
import ssl
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
CERTS = os.path.join(ROOT, "certs")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # não envia nada; só descobre a interface de rede
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def find_openssl():
    found = shutil.which("openssl")
    if found:
        return found
    for p in (r"C:\Program Files\Git\usr\bin\openssl.exe", r"C:\Program Files\Git\mingw64\bin\openssl.exe"):
        if os.path.exists(p):
            return p
    return None


def ensure_cert(ip):
    cert, key = os.path.join(CERTS, "cert.pem"), os.path.join(CERTS, "key.pem")
    if os.path.exists(cert) and os.path.exists(key):
        return cert, key
    openssl = find_openssl()
    if not openssl:
        sys.exit("OpenSSL não encontrado (vem com o Git para Windows).")
    os.makedirs(CERTS, exist_ok=True)
    subprocess.run([
        openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", key, "-out", cert, "-days", "825",
        "-subj", "/CN=CabineVR",
        "-addext", f"subjectAltName=IP:{ip},DNS:localhost",
    ], check=True, capture_output=True)
    return cert, key


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--https", action="store_true", help="servir em HTTPS na rede local (para o Quest)")
    ap.add_argument("--port", type=int, default=None)
    args = ap.parse_args()

    if args.https:
        ip = lan_ip()
        port = args.port or 8443
        cert, key = ensure_cert(ip)
        httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), NoCacheHandler)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        print(f"No navegador do Quest, abra:  https://{ip}:{port}")
        print("Aceite o aviso de conexão não segura e aperte 'Entrar em VR'.")
        print("O Quest e o PC precisam estar na mesma rede Wi-Fi. Ctrl+C para parar.")
    else:
        port = args.port or 8831
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler)
        print(f"Abra http://localhost:{port}  (Ctrl+C para parar)")
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
