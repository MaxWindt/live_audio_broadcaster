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

// startPeriodicCleanup starts a goroutine to perform regular cleanup of resources
func startPeriodicCleanup(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()

	log.Println("Starting periodic resource cleanup service")

	go func() {
		for {
			select {
			case <-ctx.Done():
				log.Println("Stopping periodic cleanup service")
				return
			case <-ticker.C:
				log.Println("Running periodic resource cleanup")

				// Clean up stale channels
				cleaned := reg.ForceCleanupStaleChannels()
				if cleaned > 0 {
					log.Printf("Cleaned up %d stale channels", cleaned)
				}

				// Run garbage collection to free up memory
				runtime.GC()

				var m runtime.MemStats
				runtime.ReadMemStats(&m)
				log.Printf("Memory stats after cleanup: Alloc=%v MiB, TotalAlloc=%v MiB, Sys=%v MiB",
					m.Alloc/1024/1024, m.TotalAlloc/1024/1024, m.Sys/1024/1024)
			}
		}
	}()
}

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

	reg = NewRegistry()

	// Start the periodic cleanup service
	cleanupCtx, cleanupCancel := context.WithCancel(context.Background())
	defer cleanupCancel()
	startPeriodicCleanup(cleanupCtx)

	go func() {
		err := srv.ListenAndServe()
		if err != nil && err != http.ErrServerClosed {
			log.Println("Error starting server:", err)
		}
	}()

	// trap sigterm or interrupt and gracefully shutdown the server
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT)
	signal.Notify(sigChan, syscall.SIGTERM)

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
