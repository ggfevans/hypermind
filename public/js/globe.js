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

  // Create wireframe globe sphere
  function createWireframeSphere(radius) {
    const geometry = new THREE.IcosahedronGeometry(radius, 2);
    const wireColor = getThemeColor('--color-particle');
    const material = new THREE.MeshBasicMaterial({
      color: wireColor,
      wireframe: true,
      transparent: true,
      opacity: 0.1
    });
    return new THREE.Mesh(geometry, material);
  }

  // Create lat/lng grid lines (graticule)
  function createGraticule(radius) {
    const lineColor = getThemeColor('--color-particle');
    const material = new THREE.LineBasicMaterial({
      color: lineColor,
      transparent: true,
      opacity: 0.25
    });

    const group = new THREE.Group();

    // Longitude lines (meridians) - every 30 degrees
    for (let lng = 0; lng < 360; lng += 30) {
      const points = [];
      for (let lat = -90; lat <= 90; lat += 5) {
        points.push(latLngToVector3(lat, lng, radius));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      group.add(new THREE.Line(geometry, material));
    }

    // Latitude lines (parallels) - every 30 degrees
    for (let lat = -60; lat <= 60; lat += 30) {
      const points = [];
      for (let lng = 0; lng <= 360; lng += 5) {
        points.push(latLngToVector3(lat, lng, radius));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      group.add(new THREE.Line(geometry, material));
    }

    return group;
  }

  // Public API
  return {
    init: function(containerId) {
      console.log('[Globe] Initializing...');
      container = document.getElementById(containerId);
      if (!container) {
        console.error('[Globe] Container not found:', containerId);
        return;
      }

      const width = container.clientWidth;
      const height = container.clientHeight;

      // Create scene
      scene = new THREE.Scene();
      scene.background = new THREE.Color(getThemeColor('--color-bg-main') || '#191716');

      // Create camera
      camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
      camera.position.z = 300;

      // Create renderer
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);

      // Create orbit controls
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.rotateSpeed = 0.5;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.5;
      controls.minDistance = 150;
      controls.maxDistance = 500;
      controls.enablePan = false;

      // Create wireframe globe
      globe = createWireframeSphere(GLOBE_RADIUS);
      scene.add(globe);

      // Create graticule
      graticule = createGraticule(GLOBE_RADIUS * 1.001);
      scene.add(graticule);

      // Add ambient light
      const light = new THREE.AmbientLight(0xffffff, 1.0);
      scene.add(light);

      // Animation loop
      let isHovering = false;
      container.addEventListener('mouseenter', () => { isHovering = true; });
      container.addEventListener('mouseleave', () => { isHovering = false; });

      function animate() {
        animationId = requestAnimationFrame(animate);
        controls.autoRotate = !isHovering;
        controls.update();
        renderer.render(scene, camera);
      }
      animate();

      // Handle resize
      function handleResize() {
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
      window.addEventListener('resize', handleResize);

      // Store cleanup reference
      this._resizeHandler = handleResize;

      isInitialized = true;
      console.log('[Globe] Initialized successfully');
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
      if (this._resizeHandler) {
        window.removeEventListener('resize', this._resizeHandler);
        this._resizeHandler = null;
      }
      if (controls) {
        controls.dispose();
        controls = null;
      }
      if (globe) {
        globe.geometry.dispose();
        globe.material.dispose();
        globe = null;
      }
      if (graticule) {
        graticule.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
        graticule = null;
      }
      if (renderer) {
        renderer.dispose();
        if (container && renderer.domElement) {
          container.removeChild(renderer.domElement);
        }
        renderer = null;
      }
      scene = null;
      camera = null;
      container = null;
      isInitialized = false;
      console.log('[Globe] Destroyed');
    },

    isReady: function() {
      return isInitialized;
    }
  };
})();

// Expose to window for integration with app.js
window.Globe = Globe;
