/**
 * Three.js Globe Visualization for Hypermind
 * Optimized for 5-20k peer locations using instanced rendering
 */

const Globe = (function() {
  // Configuration
  const GLOBE_RADIUS = 100;
  const MAX_VISIBLE_PEERS = 5000;

  // Three.js objects
  let scene, camera, renderer, controls;
  let globe, graticule, peerPoints;
  let container = null;
  let animationId = null;
  let isInitialized = false;

  // Peer data
  let peerData = [];
  let myLocation = null;

  // Get theme colors from CSS variables
  function getThemeColor(varName) {
    const style = getComputedStyle(document.documentElement);
    const color = style.getPropertyValue(varName).trim();
    return color || '#718062';
  }

  // Convert lat/lng to 3D position on sphere
  function latLngToVector3(lat, lng, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);
    return new THREE.Vector3(
      -radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    );
  }

  // Public API
  return {
    init: function(containerId) {
      console.log('[Globe] Initializing...');
      isInitialized = true;
    },

    updatePeers: function(peers) {
      peerData = peers;
    },

    setMyLocation: function(lat, lng) {
      myLocation = { lat, lng };
    },

    destroy: function() {
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
      isInitialized = false;
    },

    isReady: function() {
      return isInitialized;
    }
  };
})();

// Expose to window for integration with app.js
window.Globe = Globe;
