// Babelcast a WebRTC audio broadcast server

/*
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"
)

const httpTimeout = 15 * time.Second

var publisherPassword = ""

var reg *Registry
var monitor *ConnectionMonitor

func main() {
	webRoot := flag.String("webRoot", "html", "web root directory")
	port := flag.Int("port", 80, "listen on this port")
	flag.Parse()

	/*
		file, _ := os.Create("./cpu.pprof")
		pprof.StartCPUProfile(file)
		defer pprof.StopCPUProfile()
	*/

	log.Printf("Starting server...\n")
	log.Printf("Set web root: %s\n", *webRoot)

	publisherPassword = os.Getenv("PUBLISHER_PASSWORD")
	if publisherPassword != "" {
		log.Printf("Publisher password set\n")
	}

	http.HandleFunc("/ws", wsHandler)
	http.Handle("/", http.FileServer(http.Dir(http.Dir(*webRoot))))

	log.Printf("Listening on port :%d\n", *port)

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", *port),
		WriteTimeout: httpTimeout,
		ReadTimeout:  httpTimeout,
	}

	// Initialize connection monitor
	monitor = NewConnectionMonitor(1 * time.Minute)

	reg = NewRegistry()

	go func() {
		err := srv.ListenAndServe()
		if err != nil && err != http.ErrServerClosed {
			log.Println("Error starting server")
		}
	}()

	// Handle system signals for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan,
		syscall.SIGINT,
		syscall.SIGTERM,
		syscall.SIGHUP,  // Terminal disconnection
		syscall.SIGUSR1, // Custom signal for recovery
	)

	go func() {
		for sig := range sigChan {
			switch sig {
			case syscall.SIGHUP:
				log.Println("Terminal disconnected - continuing to run")
			case syscall.SIGUSR1:
				log.Println("Received recovery signal - initiating recovery")
				performRecovery()
			default:
				log.Printf("Received signal: %v\n", sig)
				cleanup()
				os.Exit(0)
			}
		}
	}()

	// block until a signal is received
	sig := <-sigChan
	log.Printf("Got signal: %v\n", sig)
	log.Println("Shutting down")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Graceful shutdown failed %q\n", err)
	}
}

func performRecovery() {
	// Implement recovery logic
	reg.CleanupStaleChannels()
	runtime.GC()
}

func cleanup() {
	// Implement cleanup logic
	log.Println("Cleaning up resources...")
	reg.CleanupAllChannels()
}
