/**
 * Three.js Globe Visualization for Hypermind
 * Optimized for 5-20k peer locations using instanced rendering
 */

const Globe = (function() {
  // Configuration
  const GLOBE_RADIUS = 100;
  const MAX_VISIBLE_PEERS = 5000;
  const MAX_CONNECTIONS = 3000; // Max connection lines to render
  const CONNECTION_DISTANCE = 40; // Max distance between connected peers (in 3D space)

  // Performance: only process peers in visible hemisphere
  function filterVisiblePeers(peers, cameraPosition) {
    if (!cameraPosition) return peers;

    const cameraDir = cameraPosition.clone().normalize();

    return peers.filter(peer => {
      if (peer.lat === undefined || peer.lng === undefined) return false;
      const peerPos = latLngToVector3(peer.lat, peer.lng, 1).normalize();
      // Dot product > 0 means facing camera (visible hemisphere)
      // Use -0.2 to include slightly beyond equator
      return cameraDir.dot(peerPos) > -0.2;
    });
  }

  // Three.js objects
  let scene, camera, renderer, controls;
  let globe, graticule, peerPoints, continents;
  let connectionLines = null;
  let connectionMaterial = null;
  let myLocationMarker = null;
  let container = null;
  let animationId = null;
  let isInitialized = false;
  let isBackgroundMode = false;

  // Peer data
  let peerData = [];
  let myLocation = null;
  let cachedSyntheticPeers = [];
  let lastSyntheticCount = 0;

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

  // Simplified continent outlines (major coastlines)
  const CONTINENT_PATHS = [
    // North America
    [[70,-170],[65,-168],[60,-165],[55,-165],[50,-130],[48,-125],[40,-124],[35,-120],[30,-118],[25,-110],[20,-105],[18,-97],[20,-90],[25,-82],[30,-82],[28,-80],[25,-80],[27,-82],[30,-85],[25,-90],[20,-87],[22,-98],[28,-96],[30,-93],[26,-82],[30,-81],[32,-80],[35,-75],[40,-74],[42,-70],[44,-67],[45,-64],[47,-60],[50,-57],[53,-56],[55,-60],[60,-65],[65,-62],[70,-75],[72,-95],[71,-130],[72,-160],[70,-170]],
    // South America
    [[12,-72],[10,-76],[5,-77],[0,-80],[-5,-81],[-10,-78],[-15,-75],[-20,-70],[-25,-70],[-30,-72],[-35,-72],[-40,-73],[-45,-75],[-50,-74],[-55,-68],[-55,-65],[-52,-58],[-48,-65],[-42,-63],[-38,-57],[-35,-53],[-30,-50],[-25,-47],[-20,-40],[-15,-39],[-10,-37],[-5,-35],[0,-50],[5,-60],[10,-72],[12,-72]],
    // Europe
    [[70,30],[68,25],[65,25],[60,30],[58,25],[55,20],[50,5],[48,0],[43,-9],[36,-8],[36,-5],[38,0],[42,3],[43,8],[45,13],[42,18],[40,25],[38,28],[36,28],[35,25],[37,35],[40,30],[45,30],[48,35],[50,30],[55,35],[60,30],[65,30],[70,30]],
    // Africa
    [[35,-5],[37,10],[33,12],[32,32],[30,33],[25,35],[20,38],[15,42],[10,45],[5,42],[0,42],[-5,40],[-10,40],[-15,38],[-20,35],[-25,35],[-30,30],[-35,20],[-34,18],[-30,17],[-25,15],[-20,12],[-15,12],[-10,15],[-5,10],[0,10],[5,5],[10,0],[15,-17],[20,-17],[25,-15],[28,-10],[32,-8],[35,-5]],
    // Asia (simplified)
    [[70,180],[65,180],[60,165],[55,160],[50,155],[45,145],[40,140],[35,140],[35,135],[30,130],[25,120],[22,115],[20,110],[10,105],[5,100],[0,105],[-8,115],[-8,120],[0,130],[5,125],[10,120],[15,110],[20,110],[25,122],[30,122],[35,128],[40,125],[45,135],[50,140],[55,140],[60,145],[65,160],[70,180]],
    // Australia
    [[-12,130],[-15,125],[-20,118],[-25,113],[-30,115],[-35,117],[-38,145],[-35,150],[-30,153],[-25,153],[-20,148],[-15,145],[-12,142],[-10,142],[-12,135],[-12,130]]
  ];

  // Create continent outlines using tubes for visibility
  function createContinents(radius) {
    const lineColor = getThemeColor('--color-particle');
    const material = new THREE.MeshBasicMaterial({
      color: lineColor,
      transparent: true,
      opacity: 1.0
    });

    const group = new THREE.Group();

    for (const path of CONTINENT_PATHS) {
      const points = path.map(([lat, lng]) => latLngToVector3(lat, lng, radius));
      const curve = new THREE.CatmullRomCurve3(points, false);
      const tubeGeometry = new THREE.TubeGeometry(curve, path.length * 2, 0.3, 4, false);
      group.add(new THREE.Mesh(tubeGeometry, material));
    }

    group.userData.sharedMaterial = material;
    return group;
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

    group.userData.sharedMaterial = material;

    return group;
  }

  // Create instanced mesh for peer points (optimized for thousands of points)
  function createPeerPoints(maxCount) {
    const geometry = new THREE.SphereGeometry(0.3, 6, 4); // Smaller points
    const peerColor = getThemeColor('--color-particle');
    const material = new THREE.MeshBasicMaterial({
      color: peerColor,
      transparent: true,
      opacity: 0.7
    });

    const mesh = new THREE.InstancedMesh(geometry, material, maxCount);
    mesh.count = 0; // Start with no visible instances
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    return mesh;
  }

  // Create cyberpunk connection lines between peers
  function createConnectionLines() {
    // Use LineSegments for efficient rendering of many disconnected lines
    const geometry = new THREE.BufferGeometry();
    // Pre-allocate for max connections (each line = 2 vertices * 3 coords)
    const positions = new Float32Array(MAX_CONNECTIONS * 2 * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 0); // Start with nothing drawn

    const lineColor = getThemeColor('--color-particle');
    connectionMaterial = new THREE.LineBasicMaterial({
      color: lineColor,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending // Cyberpunk glow effect
    });

    return new THREE.LineSegments(geometry, connectionMaterial);
  }

  // Update connection lines between nearby peers
  function updateConnectionLines() {
    if (!connectionLines || peerData.length < 2) {
      if (connectionLines) {
        connectionLines.geometry.setDrawRange(0, 0);
      }
      return;
    }

    // Convert peer data to 3D positions for distance calculation
    const positions3D = [];
    const validPeers = peerData.filter(p =>
      p.lat !== undefined && p.lng !== undefined && !isNaN(p.lat) && !isNaN(p.lng)
    );

    for (let i = 0; i < Math.min(validPeers.length, 500); i++) { // Limit for performance
      const peer = validPeers[i];
      const pos = latLngToVector3(peer.lat, peer.lng, GLOBE_RADIUS * 1.02);
      positions3D.push({ pos, peer });
    }

    // Find connections (pairs within distance threshold)
    const linePositions = connectionLines.geometry.attributes.position.array;
    let lineIndex = 0;
    let connectionCount = 0;

    for (let i = 0; i < positions3D.length && connectionCount < MAX_CONNECTIONS; i++) {
      // Connect to a few nearby peers (not all - would be too dense)
      let connectionsFromThisPeer = 0;
      for (let j = i + 1; j < positions3D.length && connectionsFromThisPeer < 3; j++) {
        const dist = positions3D[i].pos.distanceTo(positions3D[j].pos);
        if (dist < CONNECTION_DISTANCE && dist > 5) { // Not too close, not too far
          // Add line segment
          linePositions[lineIndex++] = positions3D[i].pos.x;
          linePositions[lineIndex++] = positions3D[i].pos.y;
          linePositions[lineIndex++] = positions3D[i].pos.z;
          linePositions[lineIndex++] = positions3D[j].pos.x;
          linePositions[lineIndex++] = positions3D[j].pos.y;
          linePositions[lineIndex++] = positions3D[j].pos.z;
          connectionCount++;
          connectionsFromThisPeer++;
        }
      }
    }

    connectionLines.geometry.attributes.position.needsUpdate = true;
    connectionLines.geometry.setDrawRange(0, connectionCount * 2); // 2 vertices per line
  }

  // Update peer point positions
  function updatePeerPointPositions() {
    if (!peerPoints || peerData.length === 0) return;

    // Filter to visible hemisphere for better performance
    const visiblePeers = camera ? filterVisiblePeers(peerData, camera.position) : peerData;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    let visibleCount = 0;

    for (let i = 0; i < visiblePeers.length && i < MAX_VISIBLE_PEERS; i++) {
      const peer = visiblePeers[i];
      position.copy(latLngToVector3(peer.lat, peer.lng, GLOBE_RADIUS * 1.02));
      matrix.setPosition(position);
      peerPoints.setMatrixAt(visibleCount, matrix);
      visibleCount++;
    }

    peerPoints.count = visibleCount;
    peerPoints.instanceMatrix.needsUpdate = true;
  }

  // Create marker for user's location
  function createMyLocationMarker() {
    const geometry = new THREE.SphereGeometry(1.5, 16, 12);
    const material = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 1.0
    });
    return new THREE.Mesh(geometry, material);
  }

  // Update my location marker position
  function updateMyLocationMarker() {
    if (!myLocationMarker || !myLocation) return;

    const pos = latLngToVector3(myLocation.lat, myLocation.lng, GLOBE_RADIUS * 1.03);
    myLocationMarker.position.copy(pos);
    myLocationMarker.visible = true;
  }

  // Update colors when theme changes
  function updateThemeColors() {
    if (!isInitialized) return;

    // Update scene background
    const bgColor = getThemeColor('--color-bg-main') || '#191716';
    scene.background = new THREE.Color(bgColor);

    // Update wireframe color
    const wireColor = getThemeColor('--color-particle');
    if (globe && globe.material) {
      globe.material.color.set(wireColor);
    }

    // Update graticule color
    if (graticule) {
      graticule.traverse((child) => {
        if (child.material) {
          child.material.color.set(wireColor);
        }
      });
    }

    // Update continent color
    if (continents) {
      continents.traverse((child) => {
        if (child.material) {
          child.material.color.set(wireColor);
        }
      });
    }

    // Update peer points color
    if (peerPoints && peerPoints.material) {
      peerPoints.material.color.set(wireColor);
    }

    // Update connection lines color
    if (connectionMaterial) {
      connectionMaterial.color.set(wireColor);
    }
  }

  // Generate synthetic peers distributed on land masses (cached for stability)
  function generateSyntheticPeers(geolocatedPeers, totalCount) {
    if (totalCount <= geolocatedPeers.length) {
      return geolocatedPeers;
    }

    const syntheticCount = totalCount - geolocatedPeers.length;

    // Always reuse cache if it exists and is big enough
    if (cachedSyntheticPeers.length >= syntheticCount) {
      return [...geolocatedPeers, ...cachedSyntheticPeers.slice(0, syntheticCount)];
    }

    // Need more peers - extend the cache (don't regenerate existing ones)
    const startIndex = cachedSyntheticPeers.length;

    // Land mass bounding boxes (lat/lng ranges)
    const landRegions = [
      { minLat: 25, maxLat: 70, minLng: -130, maxLng: -60, weight: 0.15 },   // North America
      { minLat: -55, maxLat: 12, minLng: -80, maxLng: -35, weight: 0.08 },   // South America
      { minLat: 35, maxLat: 70, minLng: -10, maxLng: 40, weight: 0.18 },     // Europe
      { minLat: -35, maxLat: 35, minLng: -20, maxLng: 50, weight: 0.12 },    // Africa
      { minLat: 10, maxLat: 55, minLng: 60, maxLng: 140, weight: 0.30 },     // Asia
      { minLat: -45, maxLat: -10, minLng: 110, maxLng: 155, weight: 0.08 },  // Australia
      { minLat: 50, maxLat: 70, minLng: 60, maxLng: 180, weight: 0.09 },     // Russia/Siberia
    ];

    for (let i = startIndex; i < syntheticCount; i++) {
      // Pick weighted random region
      let r = Math.random();
      let region = landRegions[0];
      for (const reg of landRegions) {
        r -= reg.weight;
        if (r <= 0) { region = reg; break; }
      }

      // Random position within land region bounds
      const lat = region.minLat + Math.random() * (region.maxLat - region.minLat);
      const lng = region.minLng + Math.random() * (region.maxLng - region.minLng);

      cachedSyntheticPeers.push({ id: `synthetic-${i}`, lat, lng });
    }

    return [...geolocatedPeers, ...cachedSyntheticPeers.slice(0, syntheticCount)];
  }

  // Public API
  return {
    init: function(containerId, options = {}) {
      console.log('[Globe] Initializing...');
      isBackgroundMode = options.background || false;
      container = document.getElementById(containerId);
      if (!container) {
        console.error('[Globe] Container not found:', containerId);
        return false;
      }

      // For background mode, use window dimensions since container is fixed fullscreen
      const width = isBackgroundMode ? window.innerWidth : container.clientWidth;
      const height = isBackgroundMode ? window.innerHeight : container.clientHeight;

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

      // Ensure canvas fills container properly in background mode
      if (isBackgroundMode) {
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
      }

      container.appendChild(renderer.domElement);

      // Only set relative if not already fixed (preserve background mode positioning)
      if (getComputedStyle(container).position !== 'fixed') {
        container.style.position = 'relative';
      }

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

      // Create continent outlines
      continents = createContinents(GLOBE_RADIUS * 1.002);
      scene.add(continents);

      // Create instanced peer points
      peerPoints = createPeerPoints(MAX_VISIBLE_PEERS);
      scene.add(peerPoints);

      // Create connection lines (cyberpunk effect)
      connectionLines = createConnectionLines();
      scene.add(connectionLines);

      // Create my location marker
      myLocationMarker = createMyLocationMarker();
      myLocationMarker.visible = false;
      scene.add(myLocationMarker);

      // Add ambient light
      const light = new THREE.AmbientLight(0xffffff, 1.0);
      scene.add(light);

      // Animation loop
      let isHovering = false;
      this._mouseEnterHandler = () => { isHovering = true; };
      this._mouseLeaveHandler = () => { isHovering = false; };
      container.addEventListener('mouseenter', this._mouseEnterHandler);
      container.addEventListener('mouseleave', this._mouseLeaveHandler);

      let lastCameraPos = new THREE.Vector3();
      let updateThrottle = 0;

      function animate() {
        animationId = requestAnimationFrame(animate);
        controls.autoRotate = !isHovering;
        controls.update();

        // Throttled update when camera moves significantly
        updateThrottle++;
        if (updateThrottle % 30 === 0) { // Every ~0.5 seconds at 60fps
          if (!camera.position.equals(lastCameraPos)) {
            lastCameraPos.copy(camera.position);
            updatePeerPointPositions();
          }
        }

        renderer.render(scene, camera);
      }
      animate();

      // Handle resize
      function handleResize() {
        if (!container) return;
        const w = isBackgroundMode ? window.innerWidth : container.clientWidth;
        const h = isBackgroundMode ? window.innerHeight : container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
      window.addEventListener('resize', handleResize);

      // Store cleanup reference
      this._resizeHandler = handleResize;

      // Watch for theme changes (stylesheet swap)
      const themeObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList' || mutation.attributeName === 'href') {
            setTimeout(updateThemeColors, 100); // Small delay for CSS to apply
          }
        });
      });

      const themeLink = document.getElementById('theme-css');
      if (themeLink) {
        themeObserver.observe(themeLink, { attributes: true });
      }
      themeObserver.observe(document.head, { childList: true });

      this._themeObserver = themeObserver;

      isInitialized = true;
      console.log('[Globe] Initialized successfully');
      return true;
    },

    updatePeers: function(peers, totalCount) {
      // Filter to peers with valid coordinates
      const geolocatedPeers = peers.filter(p =>
        p.lat !== undefined &&
        p.lng !== undefined &&
        !isNaN(p.lat) &&
        !isNaN(p.lng)
      );

      // Generate synthetic peers to match total network size
      const targetCount = totalCount || geolocatedPeers.length;
      peerData = generateSyntheticPeers(geolocatedPeers, targetCount);

      if (isInitialized && peerPoints) {
        updatePeerPointPositions();
      }

      if (isInitialized && connectionLines) {
        updateConnectionLines();
      }
    },

    setMyLocation: function(lat, lng) {
      myLocation = { lat, lng };
      if (isInitialized && myLocationMarker) {
        updateMyLocationMarker();
      }
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
      if (this._themeObserver) {
        this._themeObserver.disconnect();
        this._themeObserver = null;
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
        if (graticule.userData.sharedMaterial) {
          graticule.userData.sharedMaterial.dispose();
        }
        graticule.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          // Don't dispose material here - already disposed above
        });
        graticule = null;
      }
      if (continents) {
        if (continents.userData.sharedMaterial) {
          continents.userData.sharedMaterial.dispose();
        }
        continents.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
        });
        continents = null;
      }
      if (peerPoints) {
        peerPoints.geometry.dispose();
        peerPoints.material.dispose();
        peerPoints = null;
      }
      if (connectionLines) {
        connectionLines.geometry.dispose();
        connectionLines = null;
      }
      if (connectionMaterial) {
        connectionMaterial.dispose();
        connectionMaterial = null;
      }
      if (myLocationMarker) {
        myLocationMarker.geometry.dispose();
        myLocationMarker.material.dispose();
        myLocationMarker = null;
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

    updateTheme: function() {
      updateThemeColors();
    },

    isReady: function() {
      return isInitialized;
    }
  };
})();

// Expose to window for integration with app.js
window.Globe = Globe;
