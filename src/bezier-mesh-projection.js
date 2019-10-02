
(function (exportObj, exportName) {
    "use strict";

    // Temporary buffers (for memory reuse/efficency)
    let buffers = {};
    {
        buffers.vec3 = [];
        for (let i = 0; i < 16; i++)
            buffers.vec3.push(new THREE.Vector3());
    }

    class Textures {
        constructor() {
            this.loader = new THREE.TextureLoader();
            this.texturesMap = {};
        }

        load(url) {
            return new Promise((resolve, reject) => {

                if (!url)
                    resolve(null);

                if (this.texturesMap[url]) {
                    resolve(this.texturesMap[url]);
                } else {
                    this.texturesMap[url] = this.loader.load(url, (tex) => {
                        resolve(tex);
                    }, undefined, err => reject(err));
                }
            });
        }

        clear() {
            for (let t in this.texturesMap)
                this.texturesMap[t].dispose();
            this.texturesMap = {};
        }

    }

    class Util {
        /**
         * Computes the Bernsetin polinomial of grade 3
         * @param {number} i Index 
         * @param {number} t Curve parameter
         */
        static computeBernsteinBasis3(i, t) {
            let tt = t * t;
            let ttt = tt * t;
            let mt = 1 - t;
            let mtt = mt * mt;
            let mttt = mtt * mt;
            switch (i) {
                case 0:
                    return mttt;
                case 1:
                    return 3 * t * mtt;
                case 2:
                    return 3 * tt * mt;
                case 3:
                    return ttt;
                default:
                    throw new Error("Invalid index for B3: " + i);
            }
        }
    }

    class Domain {
        constructor(u0, v0, u1, v1) {
            this.u0 = u0;
            this.u1 = u1;
            this.v0 = v0;
            this.v1 = v1;
        }

        contains(u, v) {
            return u >= this.u0 && u <= this.v1 && v >= this.v0 && v <= this.v1;
        }
    }

    class Handle {
        constructor(ownerProjection, point) {
            this.point = point;
            this.ownerProjection = ownerProjection;
            this.domElement = document.createElement("div");
            this.parent = null;
            this.children = [];
            this.mirrorChildren = false;

            this.domElement.classList.add("bm-handle");
            this.domElement.addEventListener("mousedown", (evt) => {
                this.ownerProjection.selectedHandle = this;
                this.mirrorChildren = evt.button === 2;
                evt.preventDefault();
            })

            ownerProjection.container.appendChild(this.domElement);

        }

        addChildren(...children) {
            this.children.push(children);
            children.forEach(c => c.parent = this);
        }

        mirror(mirroredHandle, referenceHandle) {
            if (mirroredHandle && referenceHandle) {
                this.mirrorHandle = {
                    mirrored: mirroredHandle,
                    reference: referenceHandle
                }
            } else {
                this.mirrorHandle = null;
            }
        }

        move(x, y, mirror) {
            let offset = this.ownerProjection.screenToWorld(x, y).sub(this.point);

            this.point.add(offset);

            this.children[0] ? this.children[0].point.add(offset) : false;
            this.children[1] ? this.children[1].point.add(offset) : false;

            if (this.mirrorHandle && mirror) {
                let offset = buffers.vec3[0].copy(this.mirrorHandle.reference.point).sub(this.point);
                this.mirrorHandle.mirrored.point.copy(this.mirrorHandle.reference.point).add(offset);
            }

        }

        reposition() {
            let screenPos = this.ownerProjection.worldToScreen(this.point);
            let rect = this.domElement.getBoundingClientRect();
            this.domElement.style.left = (screenPos.x - rect.width / 2) + "px";
            this.domElement.style.top = (screenPos.y - rect.height / 2) + "px";
        }

    }

    class Patch {
        constructor(ownerProjection, topLeft, topRight, bottomLeft, bottomRight) {
            let cp = new Array(16);

            let tl = cp[12] = topLeft.clone();
            let tr = cp[15] = topRight.clone();
            let bl = cp[0] = bottomLeft.clone();
            let br = cp[3] = bottomRight.clone();

            cp[1] = bl.clone().lerp(br, 1 / 3);
            cp[2] = bl.clone().lerp(br, 2 / 3);

            cp[13] = tl.clone().lerp(tr, 1 / 3);
            cp[14] = tl.clone().lerp(tr, 2 / 3);

            cp[4] = bl.clone().lerp(tl, 1 / 3);
            cp[8] = bl.clone().lerp(tl, 2 / 3);

            cp[7] = br.clone().lerp(tr, 1 / 3);
            cp[11] = br.clone().lerp(tr, 2 / 3);

            cp[5] = new THREE.Vector3();
            cp[6] = new THREE.Vector3();
            cp[9] = new THREE.Vector3();
            cp[10] = new THREE.Vector3();

            this.ownerProjection = ownerProjection;
            this.bezierPatches = [];
            this.handles = [];

            let initialBezierPatch = new BezierPatch(this.ownerProjection, new Domain(0, 0, 1, 1), cp);
            this.bezierPatches.push(initialBezierPatch);

            // Handles
            {
                let topLeft = new Handle(this.ownerProjection, initialBezierPatch.controlPoints[12]);
                let topRight = new Handle(this.ownerProjection, initialBezierPatch.controlPoints[15]);
                let bottomLeft = new Handle(this.ownerProjection, initialBezierPatch.controlPoints[0]);
                let bottomRight = new Handle(this.ownerProjection, initialBezierPatch.controlPoints[3]);

                let bottomLeft0 = new Handle(this.ownerProjection, initialBezierPatch.controlPoints[1]);
                let bottomLeft1 = new Handle(this.ownerProjection, initialBezierPatch.controlPoints[4]);

                let bottomRight0 = new Handle(this.ownerProjection, initialBezierPatch.controlPoints[2]);
                let bottomRight1 = new Handle(this.ownerProjection, initialBezierPatch.controlPoints[7]);

                let topLeft0 = new Handle(this.ownerProjection, initialBezierPatch.controlPoints[8]);
                let topLeft1 = new Handle(this.ownerProjection, initialBezierPatch.controlPoints[13]);

                let topRight0 = new Handle(this.ownerProjection, initialBezierPatch.controlPoints[14]);
                let topRight1 = new Handle(this.ownerProjection, initialBezierPatch.controlPoints[11]);

                topLeft.addChildren(topLeft0, topLeft1);
                topLeft0.mirror(topLeft1, topLeft);
                topLeft1.mirror(topLeft0, topLeft);

                bottomLeft.addChildren(bottomLeft0, bottomLeft1);
                bottomLeft0.mirror(bottomLeft1, bottomLeft);
                bottomLeft1.mirror(bottomLeft0, bottomLeft);

                topRight.addChildren(topRight0, topRight1);
                topRight0.mirror(topRight1, topRight);
                topRight1.mirror(topRight0, topRight);

                bottomRight.addChildren(bottomRight0, bottomRight1);
                bottomRight0.mirror(bottomRight1, bottomRight);
                bottomRight1.mirror(bottomRight0, bottomRight);

                this.handles.push(
                    topLeft, topLeft0, topLeft1,
                    topRight, topRight0, topRight1,
                    bottomLeft, bottomLeft0, bottomLeft1,
                    bottomRight, bottomRight0, bottomRight1
                );
            }


        }

        compute(u, v) {
            for (let p of this.bezierPatches) {
                if (p.domain.contains(u, v))
                    return p.compute(u, v);
            }
        }

        subdivide(u, v) {

        }

        update() {
            this.bezierPatches.forEach(p => p.update());
        }
    }

    class BezierPatch {
        constructor(ownerProjection, domain, controlPoints) {
            this.ownerProjection = ownerProjection;
            this.controlPoints = controlPoints;
            this.domain = domain;
        }

        compute(u, v, mode) {
            if (mode === "linear") {
                let v0 = buffers.vec3[0].copy(this.controlPoints[0]);
                let v1 = buffers.vec3[1].copy(this.controlPoints[12]);

                v0.lerp(this.controlPoints[3], u);
                v1.lerp(this.controlPoints[15], u);

                return v0.lerp(v1, v);
            } else {
                let pRes = buffers.vec3[0].set(0, 0, 0);
                let p0 = buffers.vec3[1];
                for (let y = 0; y < 4; y++) {
                    for (let x = 0; x < 4; x++) {
                        let b = Util.computeBernsteinBasis3(x, u) * Util.computeBernsteinBasis3(y, v);
                        pRes.add(p0.copy(this.controlPoints[y * 4 + x]).multiplyScalar(b));
                    }
                }
                return pRes;
            }
        }

        update() {
            // Compute middle control points
            let cp = this.controlPoints;

            let x00 = cp[4].clone().lerp(cp[7], 1 / 3).x;
            let y00 = cp[1].clone().lerp(cp[13], 1 / 3).y;

            let x10 = cp[4].clone().lerp(cp[7], 2 / 3).x;
            let y10 = cp[2].clone().lerp(cp[14], 1 / 3).y;

            let x11 = cp[8].clone().lerp(cp[11], 2 / 3).x;
            let y11 = cp[2].clone().lerp(cp[14], 2 / 3).y;

            let x01 = cp[8].clone().lerp(cp[11], 1 / 3).x;
            let y01 = cp[1].clone().lerp(cp[13], 2 / 3).y;

            cp[5].set(x00, y00, 0);
            cp[6].set(x10, y10, 0);
            cp[9].set(x01, y01, 0);
            cp[10].set(x11, y11, 0);
        }

    }

    /**
     * Creates a new instance
     * @constructor
     * @param {object} options
     * @param {string} options.container The selector for the canvas container
     * @param {number} [options.aspectRatio] The initial aspect ratio of the plane.
     * @param {number} [options.gridSize] The number of subdivisions.
     * @param {string} [options.zoom] Camera zoom.
     * @param {string} [options.gridColor] Color used for grid lines and grid points.
     * @param {"bezier"|"linear"} [options.mode] Interpolation mode
     * @param {string} [options.texture] The url of the texture to be used
     * @param {string} [options.background] The image to be placed in the background
     * @param {boolean} [options.preview] If true, hides the grid and the control points
     */
    class BezierMeshProjection {
        constructor(options) {

            this.options = {
                container: null,
                aspectRatio: 1,
                gridSize: 20,
                zoom: 0.7,
                gridColor: "#666666",
                handleColor: "#0088ff",
                mode: "bezier",
                texture: null,
                background: null,
                preview: false
            }

            this.initialize(options.container, options.aspectRatio);
            this.reset(options);
            this.loop();
        }

        /**
         * Saves the current configuration so it can be restored later
         * @returns {object} The current configuration
         */
        save() {

        }

        /**
         * Restores the given configuration
         * @param {object} savedInstance The configuration to be restored
         */
        restore(savedInstance) {

        }

        /**
         * Change the current configuration.
         * @param {object} options 
         * @param {number} [options.gridSize] The number of subdivisions.
         * @param {string} [options.zoom] Camera zoom.
         * @param {string} [options.gridColor] Color used for grid lines and grid points.
         * @param {"bezier"|"linear"} [options.mode] Interpolation mode
         * @param {string} [options.texture] The url of the texture to be used
         * @param {string} [options.background] The image to be placed in the background
         * @param {boolean} [options.preview] If true, hides the grid and the control points
         */
        reset(options) {

            Object.assign(this.options, options);

            const gs = this.options.gridSize;
            const gs1 = gs + 1;
            const n = gs1 * gs1;
            this.meshes = {};

            // Update handles
            for (let h of this.patch.handles) {
                h.domElement.style.backgroundColor = this.options.handleColor;
                h.domElement.style.display = this.options.preview ? "none" : null;
            }

            // Initialize three.js scene

            this.scene = new THREE.Scene();
            this.camera = new THREE.OrthographicCamera(-1, 1, -1, 1, -1, 1);

            // Init grid points buffer;
            this.gridPoints = new Array((gs + 1) * (gs + 1));
            for (let i = 0; i < this.gridPoints.length; i++)
                this.gridPoints[i] = new THREE.Vector3();

            // Create background plane
            {

                this.textures.load(this.options.background).then(tex => {
                    let planeGeom = new THREE.PlaneGeometry(
                        tex.image.width / tex.image.height * 2,
                        2
                    );

                    planeGeom.translate(0, 0, -0.1);

                    this.meshes.backgroundPlane = new THREE.Mesh(planeGeom, new THREE.MeshBasicMaterial({
                        color: 0xffffff,
                        map: tex
                    }));

                    this.scene.add(this.meshes.backgroundPlane);

                });

            }

            // Create plane mesh
            {

                // Indices
                let indices = [];

                for (let y = 0; y < gs; y++) {
                    for (let x = 0; x < gs; x++) {
                        let a = y * gs1 + x;
                        let b = y * gs1 + x + 1;
                        let c = (y + 1) * gs1 + x;
                        let d = (y + 1) * gs1 + x + 1;

                        indices.push(a, b, c);
                        indices.push(b, d, c);

                    }
                }

                // Normals
                let normals = [];
                for (let i = 0; i < n; i++)
                    normals.push(0, 0, 1);

                // UVs
                let uvs = [];

                for (let y = 0; y < gs1; y++) {
                    for (let x = 0; x < gs1; x++) {
                        uvs.push(x / gs, y / gs);
                    }
                }

                let planeGeom = new THREE.BufferGeometry();

                planeGeom.addAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
                planeGeom.addAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
                planeGeom.addAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
                planeGeom.setIndex(indices);


                this.meshes.plane = new THREE.Mesh(planeGeom, new THREE.MeshBasicMaterial({
                    color: 0xffffff
                }));

                this.scene.add(this.meshes.plane);

                this.textures.load(this.options.texture).then((tex) => {
                    this.meshes.plane.material.map = tex;
                    this.meshes.plane.material.transparent = true;
                    this.meshes.plane.material.needsUpdate = true;
                });


            }

            // Create grid points mesh
            {
                let n = (gs + 1) * (gs + 1);
                let dotsGeom = new THREE.BufferGeometry();
                let dotsPositions = new Float32Array(3 * n);

                dotsGeom.addAttribute("position", new THREE.BufferAttribute(dotsPositions, 3));

                let dots = new THREE.Points(dotsGeom, new THREE.PointsMaterial({
                    color: this.options.gridColor,
                    size: 4,
                    opacity: 0.5,
                    transparent: true
                }));

                this.scene.add(dots);

                this.meshes.gridDots = dots;
            }

            // Create grid lines mesh
            {
                let indices = [];

                for (let k = 0; k < gs + 1; k++) {
                    for (let m = 0; m < gs; m++) {
                        // Horizonal line 
                        // k => row, m => column
                        indices.push(k * gs1 + m, k * gs1 + m + 1);

                        // Vertical line
                        // k => column, m => row
                        indices.push(m * gs1 + k, (m + 1) * gs1 + k);
                    }
                }

                let linesGeom = new THREE.BufferGeometry();

                linesGeom.addAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
                linesGeom.setIndex(indices);

                this.meshes.gridLines = new THREE.LineSegments(linesGeom, new THREE.LineBasicMaterial({
                    color: this.options.gridColor,
                    linewidth: 1,
                    opacity: 0.5,
                    transparent: true
                }));
                this.scene.add(this.meshes.gridLines);

            }

            // Create handle lines mesh
            {
                const vertexCount = 2 * 10000;

                let handleLinesGeom = new THREE.BufferGeometry();

                handleLinesGeom.addAttribute("position", new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));

                this.meshes.handleLines = new THREE.LineSegments(handleLinesGeom, new THREE.LineBasicMaterial({ color: this.options.handleColor }));
                this.scene.add(this.meshes.handleLines);

            }

            this.meshes.gridDots.visible = !this.options.preview;
            this.meshes.handleLines.visible = !this.options.preview;
            this.meshes.gridLines.visible = !this.options.preview;

            this.reshape();

        }

        /**
         * Called after the component is constructed.
         * @private
         */
        initialize(container, aspectRatio) {

            // Main container
            this.container = document.querySelector(container);


            // Init three.js renderer
            this.renderer = new THREE.WebGLRenderer({ antialias: true });
            this.textures = new Textures;

            this.raycaster = new THREE.Raycaster();

            // Create initial patch
            {

                let bl = buffers.vec3[0].set(-1 * aspectRatio, -1, 0);
                let br = buffers.vec3[1].set(+1 * aspectRatio, -1, 0);
                let tl = buffers.vec3[2].set(-1 * aspectRatio, +1, 0);
                let tr = buffers.vec3[3].set(+1 * aspectRatio, +1, 0);

                this.patch = new Patch(this, tl, tr, bl, br);
            }

            // Add window listeners + dom elements
            this.container.appendChild(this.renderer.domElement);
            this.container.addEventListener("mousemove", this.mousemove.bind(this));
            this.container.addEventListener("contextmenu", (evt) => evt.preventDefault());
            window.addEventListener("resize", this.reshape.bind(this));
            window.addEventListener("mouseup", this.mouseup.bind(this));

        }



        /**
         * Main loop
         * @private
         */
        loop() {
            window.requestAnimationFrame(this.loop.bind(this));

            this.updateProjectionMatrix();
            for (let h of this.patch.handles)
                h.reposition();
            this.updatePatch();
            this.updateMeshes();

            this.renderer.clearColor();

            this.renderer.render(this.scene, this.camera);
        }

        /**
         * Computes a weighted average of the given vector array
         * @private
         * @param {THREE.Vector3[]} p The points
         * @param {number[]} w The weights
         * @param {number} [f] Global factor
         */
        weightedAverage(p, w, f) {
            if (p.length != w.length)
                throw new Error("weightedAverage(): invalid parameters");

            f = f || 1;

            let vRes = this._buffers.vec3[0].set(0, 0, 0);
            for (let i = 0; i < p.length; i++) {
                vRes.add(this._buffers.vec3[1].copy(p[i]).multiplyScalar(w[i]));
            }

            return vRes.multiplyScalar(f);
        }

        updatePatch() {
            this.patch.update();
        }

        /**
         * Updates all the meshes
         * @private
         */
        updateMeshes() {
            const gs = this.options.gridSize;

            // Compute grid points
            {
                for (let x = 0; x < gs + 1; x++) {
                    for (let y = 0; y < gs + 1; y++) {
                        let point = this.patch.compute(x / gs, y / gs, this.options.mode);
                        this.gridPoints[y * (gs + 1) + x].copy(point);
                    }
                }
            }


            // Update meshes
            {
                let dotsPositions = this.meshes.gridDots.geometry.attributes.position;
                let linesPositions = this.meshes.gridLines.geometry.attributes.position;
                let planePositions = this.meshes.plane.geometry.attributes.position;

                for (let x = 0; x < gs + 1; x++) {
                    for (let y = 0; y < gs + 1; y++) {
                        let idx = y * (gs + 1) + x;
                        let bufIdx = idx * 3;

                        linesPositions.array[bufIdx + 0] = planePositions.array[bufIdx + 0] = dotsPositions.array[bufIdx + 0] = this.gridPoints[idx].x;
                        linesPositions.array[bufIdx + 1] = planePositions.array[bufIdx + 1] = dotsPositions.array[bufIdx + 1] = this.gridPoints[idx].y;
                        linesPositions.array[bufIdx + 2] = 0.01;
                        planePositions.array[bufIdx + 2] = 0;
                        dotsPositions.array[bufIdx + 2] = 0.01;
                    }
                }

                dotsPositions.needsUpdate = true;
                linesPositions.needsUpdate = true;
                planePositions.needsUpdate = true;

            }


            // Update handle lines 
            {
                let linesGeometry = this.meshes.handleLines.geometry;
                let linesPositions = linesGeometry.attributes.position;
                let count = 0;

                this.patch.handles.filter(h => h.parent).forEach(h => {

                    linesPositions.array[count * 3 + 0] = h.point.x;
                    linesPositions.array[count * 3 + 1] = h.point.y;
                    linesPositions.array[count * 3 + 2] = 0.02;

                    linesPositions.array[count * 3 + 3] = h.parent.point.x;
                    linesPositions.array[count * 3 + 4] = h.parent.point.y;
                    linesPositions.array[count * 3 + 5] = 0.02;

                    count += 2;

                });

                linesPositions.needsUpdate = true;

                linesGeometry.setDrawRange(0, count);

            }

        }
        /**
         * Updates the projection matrix
         * @private
         */
        updateProjectionMatrix() {
            let [w, h] = [this.container.clientWidth, this.container.clientHeight];
            let z = 1 / this.options.zoom;
            this.camera.left = -w / h * z;
            this.camera.right = w / h * z;
            this.camera.bottom = -z;
            this.camera.top = z;
            this.camera.near = -1;
            this.camera.far = 1;
            this.camera.updateProjectionMatrix();
        }

        /**
         * Updates the size of the renderer and the projection matrix
         * @private
         */
        reshape() {
            this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
            this.updateProjectionMatrix();
        }


        /**
         * Mouse move handle of the canvas
         * @private
         * @param {MouseEvent} evt 
         */
        mousemove(evt) {
            let t = evt.target;
            let [mx, my] = [evt.offsetX, evt.offsetY];

            if (t !== this.renderer.domElement) {
                // it's an handle
                let rect = t.getBoundingClientRect();
                mx += t.offsetLeft
                my += t.offsetTop;
            }

            if (this.selectedHandle) {
                this.selectedHandle.move(mx, my, this.selectedHandle.mirrorChildren);
            }

            // Raycaster test

            let mouseNdc = new THREE.Vector2(
                mx / this.container.clientWidth * 2 - 1,
                - (my / this.container.clientHeight) * 2 + 1
            );

            /*
            this.raycaster.setFromCamera(mouseNdc, this.camera);
            let intersects = this.raycaster.intersectObject(this.meshes.plane);
            console.log(intersects);
            if(intersects.length === 1) {
                let u = intersects[0].uv.x;
                let v = intersects[0].uv.y;

                let pu0 = new THREE.Vector3().copy(this.patch.compute(u, 0));
                let pu1 = new THREE.Vector3().copy(this.patch.compute(u, 1));
                let pv0 = new THREE.Vector3().copy(this.patch.compute(0, v));
                let pv1 = new THREE.Vector3().copy(this.patch.compute(1, v));

                console.log(pu0, pu1, pv0, pv1);
            }
            */
        }

        /**
         * Mouse up event handler for window
         * @private
         * @param {MouseEvent} evt 
         */
        mouseup(evt) {
            this.selectedHandle = null;
        }

        /**
         * Computes the world coordinates given the screen coordinates relative to the canvas
         * @private
         * @param {number} x X position 
         * @param {number} y Y position
         * @returns {Vector3} The position in world coordinates
         */
        screenToWorld(x, y) {
            x = (x / this.container.clientWidth) * 2 - 1;
            y = ((this.container.clientHeight - y) / this.container.clientHeight) * 2 - 1;
            return new THREE.Vector3(x, y, 0).unproject(this.camera);
        }

        /**
         * Computes the position in screen coordinates relative to the canvas given the
         * world coordinates
         * @private
         * @param {THREE.Vector3} v The position in world coordinates
         * @returns {THREE.Vector2} The position in screen coordintes
         */
        worldToScreen(v) {
            let uv = buffers.vec3[0].copy(v).project(this.camera);
            return new THREE.Vector2(
                (uv.x + 1) / 2 * this.container.clientWidth,
                this.container.clientHeight - (uv.y + 1) / 2 * this.container.clientHeight
            );
        }

    }

    exportObj[exportName] = {
        BezierMeshProjection: BezierMeshProjection
    }

})(window, "bm");

