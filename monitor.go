package main

import (
	"log"
	"sync"
	"time"
)

type ConnectionMonitor struct {
	sync.RWMutex
	connections     map[string]*ConnectionInfo
	cleanupInterval time.Duration
}

type ConnectionInfo struct {
	id           string
	channelName  string
	isPublisher  bool
	startTime    time.Time
	lastActivity time.Time
	state        string
}

func NewConnectionMonitor(cleanupInterval time.Duration) *ConnectionMonitor {
	m := &ConnectionMonitor{
		connections:     make(map[string]*ConnectionInfo),
		cleanupInterval: cleanupInterval,
	}
	go m.periodicCleanup()
	return m
}

func (m *ConnectionMonitor) AddConnection(id string, channelName string, isPublisher bool) {
	m.Lock()
	defer m.Unlock()
	m.connections[id] = &ConnectionInfo{
		id:           id,
		channelName:  channelName,
		isPublisher:  isPublisher,
		startTime:    time.Now(),
		lastActivity: time.Now(),
	}
	log.Printf("MONITOR: Added %s connection %s for channel %s", connectionType(isPublisher), id, channelName)
}

func (m *ConnectionMonitor) UpdateState(id string, state string) {
	m.Lock()
	defer m.Unlock()
	if conn, exists := m.connections[id]; exists {
		oldState := conn.state
		conn.state = state
		conn.lastActivity = time.Now()
		log.Printf("MONITOR: Connection %s (%s) state changed: %s -> %s",
			id, connectionType(conn.isPublisher), oldState, state)
	}
}

func (m *ConnectionMonitor) RemoveConnection(id string) {
	m.Lock()
	defer m.Unlock()
	if conn, exists := m.connections[id]; exists {
		duration := time.Since(conn.startTime)
		log.Printf("MONITOR: Removed %s connection %s for channel %s (active for %v)",
			connectionType(conn.isPublisher), id, conn.channelName, duration)
		delete(m.connections, id)
	}
}

func (m *ConnectionMonitor) periodicCleanup() {
	ticker := time.NewTicker(m.cleanupInterval)
	for range ticker.C {
		m.cleanupStaleConnections()
	}
}

func (m *ConnectionMonitor) cleanupStaleConnections() {
	m.Lock()
	defer m.Unlock()

	threshold := time.Now().Add(-3 * time.Minute)
	for id, conn := range m.connections {
		if conn.lastActivity.Before(threshold) {
			log.Printf("MONITOR: Removing stale connection %s (no activity for %v)",
				id, time.Since(conn.lastActivity))
			delete(m.connections, id)
		}
	}
}

func connectionType(isPublisher bool) string {
	if isPublisher {
		return "publisher"
	}
	return "subscriber"
}
