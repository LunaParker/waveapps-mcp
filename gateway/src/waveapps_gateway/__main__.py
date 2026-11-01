"""`waveapps-mcp-gateway`: read the environment, build the gated proxy, serve it on loopback."""

from __future__ import annotations

import sys

from waveapps_gateway.app import build_app
from waveapps_gateway.config import ConfigError, load


def main() -> int:
    try:
        config = load()
    except ConfigError as err:
        print(err, file=sys.stderr)
        return 2
    build_app(config).run(transport="http", host=config.host, port=config.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
