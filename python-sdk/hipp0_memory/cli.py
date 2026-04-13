"""CLI entry point for hipp0-memory."""

import argparse
import sys

def main():
    parser = argparse.ArgumentParser(prog="hipp0-memory", description="Hipp0 decision memory server")
    subparsers = parser.add_subparsers(dest="command")
    
    init_parser = subparsers.add_parser("init", help="Initialize a new Hipp0 project")
    init_parser.add_argument("name", nargs="?", default=".", help="Project directory name")
    init_parser.add_argument("--port", type=int, default=3100, help="Server port")
    
    subparsers.add_parser("start", help="Start the Hipp0 server")
    subparsers.add_parser("stop", help="Stop the Hipp0 server")
    
    args = parser.parse_args()
    
    if args.command == "init":
        from .server import Hipp0Server
        server = Hipp0Server(port=args.port)
        print(f"Starting Hipp0 in {args.name}...")
        server.start()
        print(f"Hipp0 is running on http://localhost:{args.port}")
        print(f"API Key: {server.api_key}")
        try:
            server._process.wait()
        except KeyboardInterrupt:
            server.stop()
    elif args.command == "start":
        from .server import Hipp0Server
        server = Hipp0Server()
        server.start()
        print(f"Hipp0 started on http://localhost:{server.port}")
    elif args.command == "stop":
        print("Stop not implemented — use Ctrl+C on the running process")
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
