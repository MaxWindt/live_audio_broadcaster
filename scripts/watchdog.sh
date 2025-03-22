#!/bin/bash

APP_NAME="audiobroadcaster"
APP_DIR="/usr/local/bin"
LOG_DIR="/usr/local/var/log"
MAX_RESTARTS=5
RESTART_WINDOW=3600  # 1 hour in seconds

restart_count=0
last_restart_time=0

while true; do
    current_time=$(date +%s)
    
    # Reset counter if we're outside the window
    if [ $((current_time - last_restart_time)) -gt $RESTART_WINDOW ]; then
        restart_count=0
    fi
    
    # Check if process is running
    if ! pgrep $APP_NAME > /dev/null; then
        echo "$(date): $APP_NAME is not running. Attempting restart..."
        
        # Check restart limits
        if [ $restart_count -ge $MAX_RESTARTS ]; then
            echo "$(date): Too many restarts in the last hour. Waiting for manual intervention."
            sleep 3600
            restart_count=0
            continue
        fi
        
        # Start the application
        $APP_DIR/$APP_NAME &
        
        # Update restart metrics
        restart_count=$((restart_count + 1))
        last_restart_time=$current_time
        
        echo "$(date): $APP_NAME restarted. Restart count: $restart_count"
    fi
    
    sleep 10
done
