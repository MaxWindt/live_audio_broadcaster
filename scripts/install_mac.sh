#!/bin/bash

# Installation paths
DAEMON_PATH="/Library/LaunchDaemons/com.audiobroadcaster.plist"
APP_PATH="/usr/local/bin/audiobroadcaster"
LOG_DIR="/usr/local/var/log/audiobroadcaster"
WORKING_DIR="/usr/local/var/audiobroadcaster"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

# Create necessary directories
echo "Creating directories..."
mkdir -p "$LOG_DIR"
mkdir -p "$WORKING_DIR"

# Set correct permissions
chown -R root:wheel "$LOG_DIR"
chmod 755 "$LOG_DIR"
chown -R root:wheel "$WORKING_DIR"
chmod 755 "$WORKING_DIR"

# Copy binary and set permissions
echo "Installing binary..."
cp ./audiobroadcaster "$APP_PATH"
chown root:wheel "$APP_PATH"
chmod 755 "$APP_PATH"

# Copy and load launchd plist
echo "Installing launchd service..."
cp ./scripts/com.audiobroadcaster.plist "$DAEMON_PATH"
chown root:wheel "$DAEMON_PATH"
chmod 644 "$DAEMON_PATH"

# Unload existing service if it exists
if launchctl list | grep -q com.audiobroadcaster; then
    echo "Unloading existing service..."
    launchctl unload "$DAEMON_PATH"
fi

# Load the service
echo "Loading service..."
if launchctl load "$DAEMON_PATH"; then
    echo "Service installed and started successfully"
    echo "Logs will be available at:"
    echo "  $LOG_DIR/output.log"
    echo "  $LOG_DIR/error.log"
else
    echo "Error: Failed to load service"
    echo "Check system logs for details"
    exit 1
fi
