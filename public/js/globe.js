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

  // Create instanced mesh for peer points (optimized for thousands of points)
  function createPeerPoints(maxCount) {
    const geometry = new THREE.SphereGeometry(0.8, 8, 6);
    const peerColor = getThemeColor('--color-particle');
    const material = new THREE.MeshBasicMaterial({
      color: peerColor,
      transparent: true,
      opacity: 0.8
    });

    const mesh = new THREE.InstancedMesh(geometry, material, maxCount);
    mesh.count = 0; // Start with no visible instances
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    return mesh;
  }

  // Update peer point positions
  function updatePeerPointPositions() {
    if (!peerPoints || peerData.length === 0) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    let visibleCount = 0;

    for (let i = 0; i < peerData.length && i < MAX_VISIBLE_PEERS; i++) {
      const peer = peerData[i];
      if (peer.lat === undefined || peer.lng === undefined) continue;

      position.copy(latLngToVector3(peer.lat, peer.lng, GLOBE_RADIUS * 1.02));
      matrix.setPosition(position);
      peerPoints.setMatrixAt(visibleCount, matrix);
      visibleCount++;
    }

    peerPoints.count = visibleCount;
    peerPoints.instanceMatrix.needsUpdate = true;
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

      // Create instanced peer points
      peerPoints = createPeerPoints(MAX_VISIBLE_PEERS);
      scene.add(peerPoints);

      // Add ambient light
      const light = new THREE.AmbientLight(0xffffff, 1.0);
      scene.add(light);

      // Animation loop
      let isHovering = false;
      this._mouseEnterHandler = () => { isHovering = true; };
      this._mouseLeaveHandler = () => { isHovering = false; };
      container.addEventListener('mouseenter', this._mouseEnterHandler);
      container.addEventListener('mouseleave', this._mouseLeaveHandler);

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
      // Filter to peers with valid coordinates
      peerData = peers.filter(p =>
        p.lat !== undefined &&
        p.lng !== undefined &&
        !isNaN(p.lat) &&
        !isNaN(p.lng)
      );

      if (isInitialized && peerPoints) {
        updatePeerPointPositions();
      }
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
      if (this._mouseEnterHandler && container) {
        container.removeEventListener('mouseenter', this._mouseEnterHandler);
        this._mouseEnterHandler = null;
      }
      if (this._mouseLeaveHandler && container) {
        container.removeEventListener('mouseleave', this._mouseLeaveHandler);
        this._mouseLeaveHandler = null;
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
      if (peerPoints) {
        peerPoints.geometry.dispose();
        peerPoints.material.dispose();
        peerPoints = null;
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
