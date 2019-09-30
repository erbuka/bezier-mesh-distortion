
(function (exportObj, exportName) {
    "use strict";


    class BezierMeshProjection {
        constructor(options) {

            this.options = Object.assign({
                aspectRatio: 1,
                gridSize: 20,
                zoom: 0.7,
                gridColor: "#666666",
                handleColor: "#0088ff",
                linkCorners: true,
                mode: "bezier",
                texture: null
            }, options);

            this.initialize();
            this.reset(options);
            this.loop();
        }

        save() {

            return {
                options: Object.assign({}, this.options),
                controlPoints: this.controlPoints.map(c => {
                    return { x: c.x, y: c.y };
                })
            }
        }

        restore(savedInstance) {
            for (let i = 0; i < this.controlPoints.length; i++) {
                let c = savedInstance.controlPoints[i];
                this.controlPoints[i].set(c.x, c.y, 0);
            }
            this.reset(savedInstance.options);
        }

        reset(options) {

            let reloadTexture = this.options.texture !== options.texture;

            Object.assign(this.options, options);

            const gs = this.options.gridSize;
            const gs1 = gs + 1;
            const n = gs1 * gs1;
            this.meshes = {};

            // update handle colors
            {
                let color = new THREE.Color(this.options.handleColor).getHexString();
                for (let h in this.handles) {
                    this.handles[h].domElement.style.backgroundColor = "#" + color;
                }
            }

            // Initialize three.js scene

            this.scene = new THREE.Scene();
            this.camera = new THREE.OrthographicCamera(-1, 1, -1, 1, -1, 1);

            // Init grid points buffer;
            this.gridPoints = new Array((gs + 1) * (gs + 1));
            for (let i = 0; i < this.gridPoints.length; i++)
                this.gridPoints[i] = new THREE.Vector3();

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

                if (options.texture === null) {
                    this.texture = null;
                } else {
                    if (this.texture == null || reloadTexture) {
                        let loader = new THREE.TextureLoader();
                        this.texture = loader.load(this.options.texture);
                    }
                }

                let planeGeom = new THREE.BufferGeometry();

                planeGeom.addAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
                planeGeom.addAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
                planeGeom.addAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
                planeGeom.setIndex(indices);


                this.meshes.plane = new THREE.Mesh(planeGeom, new THREE.MeshBasicMaterial({
                    color: 0xffffff,
                    map: this.texture
                }));

                this.scene.add(this.meshes.plane);

            }

            // Create grid points mesh
            {
                let n = (gs + 1) * (gs + 1);
                let dotsGeom = new THREE.BufferGeometry();
                let dotsPositions = new Float32Array(3 * n);

                dotsGeom.addAttribute("position", new THREE.BufferAttribute(dotsPositions, 3));

                let dots = new THREE.Points(dotsGeom, new THREE.PointsMaterial({ color: this.options.gridColor, size: 4 }));

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

                this.meshes.gridLines = new THREE.LineSegments(linesGeom, new THREE.LineBasicMaterial({ color: this.options.gridColor, linewidth: 1 }));
                this.scene.add(this.meshes.gridLines);

            }

            // Handle lines mesh
            {

                let indices = [
                    0, 1,
                    2, 3,
                    3, 7,
                    11, 15,
                    15, 14,
                    13, 12,
                    12, 8,
                    4, 0
                ];

                let handleLinesGeom = new THREE.BufferGeometry();

                handleLinesGeom.addAttribute("position", new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
                handleLinesGeom.setIndex(indices);

                this.meshes.handleLines = new THREE.LineSegments(handleLinesGeom, new THREE.MeshBasicMaterial({ color: this.options.handleColor }));

                this.scene.add(this.meshes.handleLines);
            }



            this.reshape();

        }

        initialize() {


            // Temporary buffers (for memory reuse/efficency)
            this._buffers = {
                vec3: []
            };
            for (let i = 0; i < 16; i++)
                this._buffers.vec3.push(new THREE.Vector3());

            // Main container
            this.container = document.querySelector(this.options.container);


            // Init three.js renderer
            this.renderer = new THREE.WebGLRenderer({ antialias: true });
            this.texture = null;

            // Initialize control points and hanles
            this.controlPoints = new Array(16);
            this.handles = {};

            for (let i = 0; i < this.controlPoints.length; i++)
                this.controlPoints[i] = new THREE.Vector3();

            let bl = this._buffers.vec3[0].set(-1 * this.options.aspectRatio, -1, 0);
            let br = this._buffers.vec3[1].set(+1 * this.options.aspectRatio, -1, 0);
            let tl = this._buffers.vec3[2].set(-1 * this.options.aspectRatio, +1, 0);
            let tr = this._buffers.vec3[3].set(+1 * this.options.aspectRatio, +1, 0);

            this.controlPoints[0].copy(bl); // bottom left
            this.controlPoints[3].copy(br); // bottom right
            this.controlPoints[12].copy(tl); // top left
            this.controlPoints[15].copy(tr); // top right



            for (let x = 0; x < 4; x++) {
                for (let y = 0; y < 4; y++) {
                    this.controlPoints[y * 4 + x].copy(this.computeLinearGridPoint(x / 3, y / 3));
                }
            }

            this.handles.bottomLeft0 = this.linkHandle(".bm-handle.bm-link-0", this.controlPoints[1]);
            this.handles.bottomLeft1 = this.linkHandle(".bm-handle.bm-link-1", this.controlPoints[4]);

            this.handles.bottomRight0 = this.linkHandle(".bm-handle.bm-link-2", this.controlPoints[2]);
            this.handles.bottomRight1 = this.linkHandle(".bm-handle.bm-link-3", this.controlPoints[7]);

            this.handles.topLeft0 = this.linkHandle(".bm-handle.bm-link-4", this.controlPoints[13]);
            this.handles.topLeft1 = this.linkHandle(".bm-handle.bm-link-5", this.controlPoints[8]);

            this.handles.topRight0 = this.linkHandle(".bm-handle.bm-link-6", this.controlPoints[14]);
            this.handles.topRight1 = this.linkHandle(".bm-handle.bm-link-7", this.controlPoints[11]);

            /*
            this.handles.middle0 = this.linkHandle(".bm-handle.bm-middle-0", this.controlPoints[5]);
            this.handles.middle1 = this.linkHandle(".bm-handle.bm-middle-1", this.controlPoints[6]);
            this.handles.middle2 = this.linkHandle(".bm-handle.bm-middle-2", this.controlPoints[9]);
            this.handles.middle3 = this.linkHandle(".bm-handle.bm-middle-3", this.controlPoints[10]);
            */

            this.handles.topLeft = this.linkHandle(".bm-handle.bm-top-left", this.controlPoints[12]);
            this.handles.topLeft.setChild(0, this.handles.topLeft0);
            this.handles.topLeft.setChild(1, this.handles.topLeft1);

            this.handles.topRight = this.linkHandle(".bm-handle.bm-top-right", this.controlPoints[15]);
            this.handles.topRight.setChild(0, this.handles.topRight0);
            this.handles.topRight.setChild(1, this.handles.topRight1);

            this.handles.bottomLeft = this.linkHandle(".bm-handle.bm-bottom-left", this.controlPoints[0]);
            this.handles.bottomLeft.setChild(0, this.handles.bottomLeft0);
            this.handles.bottomLeft.setChild(1, this.handles.bottomLeft1);

            this.handles.bottomRight = this.linkHandle(".bm-handle.bm-bottom-right", this.controlPoints[3]);
            this.handles.bottomRight.setChild(0, this.handles.bottomRight0);
            this.handles.bottomRight.setChild(1, this.handles.bottomRight1);

            // Add window listeners + dom elements
            this.container.appendChild(this.renderer.domElement);
            this.container.addEventListener("mousemove", this.mousemove.bind(this), false);

            window.addEventListener("resize", this.reshape.bind(this));
            window.addEventListener("mouseup", this.mouseup.bind(this));
        }

        linkHandle(selector, pointRef) {
            let element = this.container.querySelector(selector);

            if (!element) {
                console.warn("Can't find handle selector: " + selector);
                return;
            }

            let handle = {
                pointRef: pointRef,
                domElement: element,
                children: [null, null],
                parent: null,
                setChild: (index, childHandle) => {
                    if (typeof index !== "number" || index < 0 || index >= 2)
                        throw new Error("Invalid child handle parameters");

                    handle.children[index] = childHandle;
                    childHandle.parent = handle;
                },
                getOtherChild: (childHandle) => {
                    return handle.children[0] === childHandle ? handle.children[1] : handle.children[0];
                },
                reposition: () => {
                    let screenPos = this.worldToScreen(handle.pointRef);
                    element.style.left = screenPos.x + "px";
                    element.style.top = screenPos.y + "px";
                }
            }


            element.addEventListener("mousedown", (evt) => {
                this.selectedHandle = handle;
                evt.preventDefault();
            });

            return handle;

        }

        computeBernsteinBasis3(i, t) {
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

        loop() {
            window.requestAnimationFrame(this.loop.bind(this));

            this.updateProjectionMatrix();
            this.updateHandles();
            this.updateMidControlPoints();
            this.updateMeshes();

            this.renderer.clearColor();

            this.renderer.render(this.scene, this.camera);
        }

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

        computeBezierGridPoint(u, v) {
            let pRes = this._buffers.vec3[0].set(0, 0, 0);
            let p0 = this._buffers.vec3[1];
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    let b = this.computeBernsteinBasis3(x, u) * this.computeBernsteinBasis3(y, v);
                    pRes.add(p0.copy(this.controlPoints[y * 4 + x]).multiplyScalar(b));
                }
            }
            return pRes;
        }

        computeLinearGridPoint(u, v) {
            let v0 = this._buffers.vec3[0].copy(this.controlPoints[0]);
            let v1 = this._buffers.vec3[1].copy(this.controlPoints[12]);

            v0.lerp(this.controlPoints[3], u);
            v1.lerp(this.controlPoints[15], u);

            return v0.lerp(v1, v);
        }

        updateMeshes() {
            const gs = this.options.gridSize;

            let computeFn = this.options.mode === "linear" ?
                this.computeLinearGridPoint.bind(this) :
                this.computeBezierGridPoint.bind(this);

            // Compute grid points
            {
                for (let x = 0; x < gs + 1; x++) {
                    for (let y = 0; y < gs + 1; y++) {
                        let point = computeFn(x / gs, y / gs);
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
                        linesPositions.array[bufIdx + 2] = planePositions.array[bufIdx + 2] = dotsPositions.array[bufIdx + 2] = this.gridPoints[idx].z;
                    }
                }

                dotsPositions.needsUpdate = true;
                linesPositions.needsUpdate = true;
                planePositions.needsUpdate = true;

            }

            // Update handle lines 
            {
                let handleLinesPositions = this.meshes.handleLines.geometry.attributes.position;

                for (let i = 0; i < this.controlPoints.length; i++) {
                    handleLinesPositions.array[i * 3 + 0] = this.controlPoints[i].x;
                    handleLinesPositions.array[i * 3 + 1] = this.controlPoints[i].y;
                    handleLinesPositions.array[i * 3 + 2] = this.controlPoints[i].z;
                }

                handleLinesPositions.needsUpdate = true;
            }
        }

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

        reshape() {
            this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
            this.updateProjectionMatrix();
        }

        updateMidControlPoints() {
            let cp = this.controlPoints;

            cp[5].copy(this.weightedAverage(
                [cp[4], cp[1], cp[8], cp[13], cp[2], cp[7]],
                [1 / 4, 1 / 4, 1 / 8, 1 / 8, 1 / 8, 1 / 8]
            ));

            cp[6].copy(this.weightedAverage(
                [cp[2], cp[7], cp[4], cp[1], cp[14], cp[11]],
                [1 / 4, 1 / 4, 1 / 8, 1 / 8, 1 / 8, 1 / 8]
            ));

            cp[9].copy(this.weightedAverage(
                [cp[8], cp[13], cp[4], cp[1], cp[14], cp[11]],
                [1 / 4, 1 / 4, 1 / 8, 1 / 8, 1 / 8, 1 / 8]
            ));

            cp[10].copy(this.weightedAverage(
                [cp[14], cp[11], cp[2], cp[7], cp[8], cp[13]],
                [1 / 4, 1 / 4, 1 / 8, 1 / 8, 1 / 8, 1 / 8]
            ));
        }

        updateHandles() {
            for (let h in this.handles) {
                this.handles[h].reposition();
            }
        }

        mousemove(evt) {
            if (this.selectedHandle && evt.target === this.renderer.domElement) {

                let [mx, my] = [evt.offsetX, evt.offsetY];
                let h = this.selectedHandle;
                let e = h.domElement;

                e.style.left = mx + "px";
                e.style.top = my + "px";

                let offset = this.screenToWorld(mx, my).sub(h.pointRef);

                h.pointRef.add(offset);

                if (this.options.linkCorners) {
                    h.children[0] ? h.children[0].pointRef.add(offset) : true;
                    h.children[1] ? h.children[1].pointRef.add(offset) : true;

                    if (h.parent) {
                        let otherChild = h.parent.getOtherChild(h);
                        let offset = this._buffers.vec3[0].copy(h.parent.pointRef).sub(h.pointRef);
                        otherChild.pointRef.copy(h.parent.pointRef).add(offset);
                    }
                }

            }
        }

        mouseup(evt) {
            this.selectedHandle = null;
        }

        screenToWorld(x, y) {
            x = (x / this.container.clientWidth) * 2 - 1;
            y = ((this.container.clientHeight - y) / this.container.clientHeight) * 2 - 1;
            return new THREE.Vector3(x, y, 0).unproject(this.camera);
        }

        worldToScreen(v) {
            let uv = this._buffers.vec3[0].copy(v).project(this.camera);
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

