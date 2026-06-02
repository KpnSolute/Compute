#!/bin/bash

# Default to current directory if no argument is provided
TARGET_DIR="${1:-.}"

# Find and delete files ending in Zone.Identifier
# Capture the number of files deleted
DELETED_COUNT=$(find "$TARGET_DIR" -name "*Zone.Identifier" -print -delete | wc -l)

echo "Cleanup complete."
echo "Number of Zone.Identifier files deleted: $DELETED_COUNT"
