#!/bin/sh
# Starts the Blender MCP server for Claude Code (`.mcp.json`) from the venv that
# `yarn setupBlenderMcp` builds in `.tools/blender-mcp/`, with the Blender it recorded as
# BLENDER_PATH (the background `_for_cli` tools start it) unless one is set already.
# The server talks MCP over stdio, so this writes nothing to stdout.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$ROOT/.tools/blender-mcp"
if [ ! -x "$DIR/venv/bin/blender-mcp" ]; then
  echo "The Blender MCP server isn't installed: run \`yarn setupBlenderMcp\` in $ROOT." >&2
  exit 1
fi
if [ -z "$BLENDER_PATH" ] && [ -f "$DIR/blender-path" ]; then
  BLENDER_PATH="$(cat "$DIR/blender-path")"
  export BLENDER_PATH
fi
exec "$DIR/venv/bin/blender-mcp" "$@"
