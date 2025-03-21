package main

import (
	"fmt"
	"log"
	"sync"

	"github.com/pion/webrtc/v3"
)

// keep track of which channels are being used
// only permit one publisher per channel
type Registry struct {
	sync.Mutex
	Channels map[string]*Channel
}

type Channel struct {
	PublisherCount  int
	SubscriberCount int
	Active          bool
	LocalTrack      *webrtc.TrackLocalStaticRTP
}

/*
type Client struct {
	Username string
}
*/

func NewRegistry() *Registry {
	r := &Registry{}
	r.Channels = make(map[string]*Channel)
	return r
}

func (r *Registry) AddPublisher(channelName string, localTrack *webrtc.TrackLocalStaticRTP) error {
	var channel *Channel
	var ok bool
	r.Lock()
	defer r.Unlock()
	if channel, ok = r.Channels[channelName]; ok {
		if channel.PublisherCount > 0 {
			return fmt.Errorf("channel '%s' is already in use", channelName)
		}
		channel.PublisherCount++
		channel.Active = true
		channel.LocalTrack = localTrack
	} else {
		r.Channels[channelName] = &Channel{PublisherCount: 1, Active: true, LocalTrack: localTrack}
	}
	return nil
}

func (r *Registry) AddSubscriber(channelName string) error {
	var channel *Channel
	var ok bool

	r.Lock()
	defer r.Unlock()
	if channel, ok = r.Channels[channelName]; ok && channel.Active {
		channel.SubscriberCount++
	} else {
		return fmt.Errorf("channel '%s' not ready", channelName)
	}
	return nil
}

func (r *Registry) RemovePublisher(channelName string) {
	r.Lock()
	defer r.Unlock()
	if channel, ok := r.Channels[channelName]; ok {
		channel.PublisherCount--
		if channel.PublisherCount == 0 {
			channel.Active = false
		}
	}
}

func (r *Registry) RemoveSubscriber(channelName string) {
	r.Lock()
	defer r.Unlock()
	if channel, ok := r.Channels[channelName]; ok {
		channel.SubscriberCount--
	}
}

func (r *Registry) GetChannels() []string {
	r.Lock()
	defer r.Unlock()
	channels := make([]string, 0)
	for name, c := range r.Channels {
		if c.Active {
			channels = append(channels, name)
		}
	}
	return channels
}

func (r *Registry) GetChannel(channelName string) *Channel {
	r.Lock()
	defer r.Unlock()
	for name, c := range r.Channels {
		if c.Active && name == channelName {
			return c
		}
	}
	return nil
}

// CleanupChannel ensures all resources for a channel are properly released
func (r *Registry) CleanupChannel(channelName string) {
	r.Lock()
	defer r.Unlock()

	if channel, ok := r.Channels[channelName]; ok {
		// Log the cleanup operation
		log.Printf("Cleaning up channel '%s' - Publishers: %d, Subscribers: %d, Active: %t",
			channelName, channel.PublisherCount, channel.SubscriberCount, channel.Active)

		// Mark as inactive first to prevent new connections during cleanup
		channel.Active = false

		// Important: Reset the track to allow proper garbage collection
		if channel.LocalTrack != nil {
			// No direct way to "close" a track, but we can help GC by removing references
			channel.LocalTrack = nil
		}

		// If there are no subscribers, remove the channel completely
		if channel.SubscriberCount <= 0 {
			delete(r.Channels, channelName)
			log.Printf("Channel '%s' has been completely removed from registry", channelName)
		} else {
			// If there are still subscribers, just mark it as inactive with no publishers
			channel.PublisherCount = 0
			log.Printf("Channel '%s' marked as inactive but kept for %d subscribers",
				channelName, channel.SubscriberCount)
		}
	}
}

// VerifyChannelAvailable checks if a channel can accept a new publisher
func (r *Registry) VerifyChannelAvailable(channelName string) error {
	r.Lock()
	defer r.Unlock()

	// Check if channel exists and is in use by a publisher
	if channel, ok := r.Channels[channelName]; ok {
		if channel.PublisherCount > 0 {
			// Check if the channel is really active or just in a stale state
			if channel.Active {
				return fmt.Errorf("channel '%s' is already in use", channelName)
			} else {
				// Channel exists but is marked inactive, clean it up first
				log.Printf("Found stale channel '%s', cleaning up before reuse", channelName)

				// Reset the publisher count and other attributes
				channel.PublisherCount = 0
				// We keep the LocalTrack nil here as it will be set by the new publisher
			}
		}
	}

	return nil
}

// ForceCleanupStaleChannels can be called periodically to ensure no stale channels exist
func (r *Registry) ForceCleanupStaleChannels() int {
	r.Lock()
	defer r.Unlock()

	cleaned := 0
	for name, channel := range r.Channels {
		// Check for potential stale channels
		if (channel.PublisherCount > 0 && !channel.Active) ||
			(channel.PublisherCount == 0 && channel.SubscriberCount == 0) {
			log.Printf("Found stale channel '%s' during cleanup", name)

			// Reset the channel
			channel.PublisherCount = 0
			channel.Active = false
			channel.LocalTrack = nil

			cleaned++

			if channel.SubscriberCount <= 0 {
				delete(r.Channels, name)
				log.Printf("Removed stale channel '%s' from registry", name)
			}
		}
	}

	return cleaned
}

func (r *Registry) CleanupChannel(channelName string) {
	r.Lock()
	defer r.Unlock()

	if channel, exists := r.Channels[channelName]; exists {
		channel.PublisherCount = 0
		channel.Active = false
		channel.LocalTrack = nil

		if channel.SubscriberCount <= 0 {
			delete(r.Channels, channelName)
			log.Printf("Removed channel '%s' from registry during cleanup", channelName)
		}
	}
}
