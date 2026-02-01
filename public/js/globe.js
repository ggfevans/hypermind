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

  // GeoJSON land data for accurate boundaries
  let landPolygons = [];
  let geoDataLoaded = false;

  // Get theme colors from CSS variables
  function getThemeColor(varName) {
    const style = getComputedStyle(document.documentElement);
    const color = style.getPropertyValue(varName).trim();
    return color || '#718062';
  }

  // Load GeoJSON land boundaries
  async function loadGeoData() {
    if (geoDataLoaded) return;
    try {
      const response = await fetch('/data/land.geojson');
      const geojson = await response.json();
      landPolygons = [];

      for (const feature of geojson.features) {
        if (feature.geometry.type === 'Polygon') {
          landPolygons.push(feature.geometry.coordinates[0]);
        } else if (feature.geometry.type === 'MultiPolygon') {
          for (const poly of feature.geometry.coordinates) {
            landPolygons.push(poly[0]);
          }
        }
      }
      geoDataLoaded = true;
      console.log('[Globe] Loaded', landPolygons.length, 'land polygons');

      // Build sample points for efficient random land point generation
      buildLandSamplePoints();

      // Clear cache so points get regenerated with proper land constraints
      cachedSyntheticPeers = [];
      lastSyntheticCount = 0;

      // Trigger re-render if we have peer data
      if (peerData.length > 0) {
        updatePeerPointPositions();
        updateConnectionLines();
      }
    } catch (e) {
      console.error('[Globe] Failed to load GeoJSON:', e);
    }
  }

  // Point-in-polygon test (ray casting algorithm)
  function pointInPolygon(lat, lng, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];

      if (((yi > lat) !== (yj > lat)) &&
          (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  // Check if point is on land
  function isOnLand(lat, lng) {
    if (!geoDataLoaded || landPolygons.length === 0) return true; // Allow if no data
    for (const polygon of landPolygons) {
      if (pointInPolygon(lat, lng, polygon)) return true;
    }
    return false;
  }

  // Pre-computed land sample points (generated once from GeoJSON centroids)
  let landSamplePoints = [];

  // Build sample points from polygon centroids
  function buildLandSamplePoints() {
    if (landSamplePoints.length > 0 || !geoDataLoaded) return;

    for (const polygon of landPolygons) {
      if (polygon.length < 4) continue;

      // Calculate centroid
      let sumLng = 0, sumLat = 0;
      for (const [lng, lat] of polygon) {
        sumLng += lng;
        sumLat += lat;
      }
      const centLng = sumLng / polygon.length;
      const centLat = sumLat / polygon.length;

      // Add centroid and some random points inside polygon
      if (isOnLand(centLat, centLng)) {
        landSamplePoints.push({ lat: centLat, lng: centLng });
      }

      // Add random samples within polygon bounding box
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const [lng, lat] of polygon) {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }

      // Add a few samples per polygon
      for (let i = 0; i < 5; i++) {
        const lat = minLat + Math.random() * (maxLat - minLat);
        const lng = minLng + Math.random() * (maxLng - minLng);
        if (isOnLand(lat, lng)) {
          landSamplePoints.push({ lat, lng });
        }
      }
    }

    console.log('[Globe] Built', landSamplePoints.length, 'land sample points');
  }

  // Generate random point on land
  function randomLandPoint() {
    // If we have sample points, pick one and add jitter
    if (landSamplePoints.length > 0) {
      const sample = landSamplePoints[Math.floor(Math.random() * landSamplePoints.length)];
      // Add small jitter (±2°) and verify still on land
      for (let i = 0; i < 10; i++) {
        const lat = sample.lat + (Math.random() - 0.5) * 4;
        const lng = sample.lng + (Math.random() - 0.5) * 4;
        if (isOnLand(lat, lng)) {
          return { lat, lng };
        }
      }
      // Return sample point without jitter
      return { lat: sample.lat, lng: sample.lng };
    }

    // Fallback: try random points in land regions
    for (let i = 0; i < 100; i++) {
      const regions = [
        { minLat: 25, maxLat: 60, minLng: -130, maxLng: -60, weight: 0.15 },
        { minLat: 35, maxLat: 70, minLng: -10, maxLng: 60, weight: 0.25 },
        { minLat: 5, maxLat: 55, minLng: 70, maxLng: 145, weight: 0.35 },
        { minLat: -35, maxLat: 35, minLng: -20, maxLng: 55, weight: 0.10 },
        { minLat: -55, maxLat: 15, minLng: -80, maxLng: -35, weight: 0.08 },
        { minLat: -45, maxLat: -10, minLng: 110, maxLng: 155, weight: 0.07 },
      ];

      let r = Math.random();
      let region = regions[0];
      for (const reg of regions) {
        r -= reg.weight;
        if (r <= 0) { region = reg; break; }
      }

      const lat = region.minLat + Math.random() * (region.maxLat - region.minLat);
      const lng = region.minLng + Math.random() * (region.maxLng - region.minLng);

      if (isOnLand(lat, lng)) {
        return { lat, lng };
      }
    }

    // Last resort: known land coordinates
    const knownLand = [
      { lat: 40, lng: -74 },   // New York
      { lat: 51, lng: 0 },     // London
      { lat: 35, lng: 139 },   // Tokyo
      { lat: 39, lng: 116 },   // Beijing
      { lat: -34, lng: 151 },  // Sydney
    ];
    return knownLand[Math.floor(Math.random() * knownLand.length)];
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

  // Create continent outlines from GeoJSON data
  function createContinentsFromGeoJSON(radius) {
    const lineColor = getThemeColor('--color-particle');
    const material = new THREE.MeshBasicMaterial({
      color: lineColor,
      transparent: true,
      opacity: 0.6  // Lower opacity for outline-only look
    });

    const group = new THREE.Group();

    // Only render polygons with enough points for visible coastlines
    for (const polygon of landPolygons) {
      if (polygon.length < 10) continue; // Skip tiny islands

      // Simplify: take every Nth point for performance
      const step = Math.max(1, Math.floor(polygon.length / 100));
      const points = [];
      for (let i = 0; i < polygon.length; i += step) {
        const [lng, lat] = polygon[i]; // GeoJSON is [lng, lat]
        points.push(latLngToVector3(lat, lng, radius));
      }

      if (points.length < 4) continue;

      try {
        const curve = new THREE.CatmullRomCurve3(points, true); // closed loop
        // 2x thicker lines (0.5 radius)
        const tubeGeometry = new THREE.TubeGeometry(curve, points.length * 2, 0.5, 6, true);
        group.add(new THREE.Mesh(tubeGeometry, material));
      } catch (e) {
        // Skip problematic polygons
      }
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
    const geometry = new THREE.SphereGeometry(0.35, 6, 4);
    // Use accent color (count color) for contrast against continent lines
    const peerColor = getThemeColor('--color-count') || '#ffffff';
    const material = new THREE.MeshBasicMaterial({
      color: peerColor,
      transparent: true,
      opacity: 0.9
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

    // Update peer points color (use accent color for contrast)
    const accentColor = getThemeColor('--color-count') || '#ffffff';
    if (peerPoints && peerPoints.material) {
      peerPoints.material.color.set(accentColor);
    }

    // Update connection lines color
    if (connectionMaterial) {
      connectionMaterial.color.set(wireColor);
    }
  }

  // Generate synthetic peers constrained to land (cached for stability)
  function generateSyntheticPeers(geolocatedPeers, totalCount) {
    if (totalCount <= geolocatedPeers.length) {
      return geolocatedPeers;
    }

    const syntheticCount = totalCount - geolocatedPeers.length;

    // Always reuse cache if it exists and is big enough
    if (cachedSyntheticPeers.length >= syntheticCount) {
      return [...geolocatedPeers, ...cachedSyntheticPeers.slice(0, syntheticCount)];
    }

    // Need more peers - extend the cache using land-constrained points
    const startIndex = cachedSyntheticPeers.length;

    for (let i = startIndex; i < syntheticCount; i++) {
      const point = randomLandPoint();
      cachedSyntheticPeers.push({ id: `synthetic-${i}`, lat: point.lat, lng: point.lng });
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

      // Load GeoJSON and create continent outlines (async)
      loadGeoData().then(() => {
        if (geoDataLoaded && scene) {
          continents = createContinentsFromGeoJSON(GLOBE_RADIUS * 1.002);
          scene.add(continents);
        }
      });

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
