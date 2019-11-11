
(function (exportObj, exportName) {
    "use strict";

    // Temporary buffers (for memory reuse + efficiency)
    let buffers = {};
    {
        buffers.vec3 = [];
        for (let i = 0; i < 16; i++)
            buffers.vec3.push(new THREE.Vector3());

        buffers.vec2 = [];
        for (let i = 0; i < 16; i++)
            buffers.vec2.push(new THREE.Vector2());

    }

    /**
     * Keys for tools
     */
    const Tools = {
        Arrow: "Arrow",
        HorizontalCut: "Horizontal Cut",
        VerticalCut: "Vertical Cut",
        Pan: "Pan"
    }

    /**
     * Class to hold a grid (2d matrix) of objects.
     * It has handy mehtods for manipulating rows and
     * columns
     */
    class Grid {
        /**
         * @constructor
         * @param {number} [rows] The initial number of rows
         * @param {nunber} [cols] The initial number of columns
         */
        constructor(rows, cols) {
            this.rowCount = rows || 1;
            this.colCount = cols || 1;
            this.cells = new Array(rows * cols).fill(null);
        }
        /**
         * Iterate through the cells
         */
        [Symbol.iterator]() { return this.cells.values(); }

        /**
         * Applies the given function to all the cells
         * @param {callback} predicate Function to apply
         */
        forEach(predicate) {
            this.cells.forEach(predicate);
        }
        /**
         * Returns the object at i-th row and j-th column
         * @param {number} i Row index 
         * @param {number} j Column index
         * @returns {*} The item, or null if the cell is out of bounds
         */
        get(i, j) {
            if (i < 0 || i > this.rowCount - 1 || j < 0 || j > this.colCount - 1)
                return null;
            return this.cells[i * this.colCount + j];
        }
        /**
         * Sets the cell at i-th row and j-th column with the given value
         * @param {number} i Row index
         * @param {number} j Column index
         * @param {*} v The value
         */
        set(i, j, v) {
            this.cells[i * this.colCount + j] = v;
        }

        /**
         * Deletes a column
         * @param {number} j Column index 
         */
        deleteColumn(j) {
            for (let i = this.rowCount - 1; i >= 0; i--)
                this.cells.splice(i * this.colCount + j, 1);
            this.colCount--;
        }

        /**
         * Deletes a row
         * @param {number} i The row index 
         */
        deleteRow(i) {
            this.cells.splice(i * this.colCount, this.colCount);
            this.rowCount--;
        }

        /**
         * Get the rows as an array
         * @returns {array} The rows
         */
        rows() {
            let rows = [];

            for (let i = 0; i < this.rowCount; i++) {
                let row = [];
                for (let j = 0; j < this.colCount; j++) {
                    row.push(this.cells[i * this.colCount + j]);
                }
                rows.push(row);
            }
            return rows;
        }

        /**
         * Inserts a new row
         * @param {number} index The index to insert at
         */
        inserRow(index) {
            this.cells.splice(index * this.colCount, 0, ...new Array(this.colCount).fill(null));
            this.rowCount++;
        }

        /**
         * Inserts a new column
         * @param {number} index The index to insert at
         */
        insertColumn(index) {
            for (let i = 0; i < this.rowCount; i++)
                this.cells.splice(i * (this.colCount + 1) + index, 0, null);
            this.colCount++;
        }

        /**
         * Get the columns as an array
         * @returns {array} The columns
         */
        columns() {
            let cols = [];

            for (let j = 0; j < this.colCount; j++) {
                let col = [];
                for (let i = 0; i < this.rowCount; i++) {
                    col.push(this.cells[i * this.colCount + j]);
                }
                cols.push(col);
            }

            return cols;

        }
    }

    /**
     * Helper class to cache textures and avoid reload
     */
    class Textures {
        /**
         * @constructor
         */
        constructor() {
            this.loader = new THREE.TextureLoader();
            this.texturesMap = {};
        }

        /**
         * Loads a texture
         * @param {string} url 
         * @returns {Promise} a promise that is fulfilled when the texture is loaded
         */
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

        /**
         * Clears the current texture cache
         */
        clear() {
            for (let t in this.texturesMap)
                this.texturesMap[t].dispose();
            this.texturesMap = {};
        }

    }

    /**
     * Class to hold history stack (for undo and redo)
     */
    class History {
        /**
         * @constructor
         */
        constructor() {
            this.index = -1;
            this.data = [];
        }

        /**
         * @returns The current history element
         */
        current() {
            return this.data[this.index];
        }

        /**
         * Inserts a new element at the current index and deletes all the elements that come next
         * @param {*} e The data to insert 
         */
        insert(e) {
            this.index++;
            let deleteCount = Math.max(0, this.data.length - this.index);
            this.data.splice(this.index, deleteCount, e);
        }

        /**
         * Goes back by one element
         */
        back() {
            this.index = Math.max(0, this.index - 1);
        }

        /**
         * Goes forward by one element
         */
        forward() {
            this.index = Math.min(this.data.length - 1, this.index + 1);
        }

    }

    /**
     * Utility functions
     */
    class Util {



        /**
         * Computes a weighted average of the given vector array
         * @private
         * @param {THREE.Vector3[]} p The points
         * @param {number[]} w The weights
         * @param {number} [f] Global factor
         */
        static weightedAverage(p, w, f) {
            if (p.length != w.length)
                throw new Error("weightedAverage(): invalid parameters");

            f = f || 1;

            let vRes = buffers.vec3[0].set(0, 0, 0);
            for (let i = 0; i < p.length; i++) {
                vRes.add(buffers.vec3[1].copy(p[i]).multiplyScalar(w[i]));
            }

            return vRes.multiplyScalar(f);
        }

        /**
         * Constructs an array of the given length and fills it with
         * objects created with the given constructor function
         * @param {number} size Size of the new array
         * @param {function} ctor The constructor function
         * @param  {...any} args The parameters for the constructor
         */
        static makeArray(size, ctor, ...args) {
            let r = new Array(size);
            for (let i = 0; i < size; i++)
                r[i] = new ctor(...args);
            return r;
        }

        /**
         * Computes the Bernstein derivative of grade 3
         * @param {number} i Index
         * @param {number} t Curve parameter
         * @returns {number} The derivative
         */
        static computeBernsetinDerivative3(i, t) {
            let tt = t * t;
            let mt = 1 - t;
            let mtt = mt * mt;
            switch (i) {
                case 0:
                    return - 3 * mtt;
                case 1:
                    return 3 * (t - 1) * (3 * t - 1);
                case 2:
                    return 6 * t - 9 * tt;
                case 3:
                    return 3 * tt;
                default:
                    throw new Error("Invalid index for B3': " + i);
            }
        }

        /**
         * Computes the Bernsetin polinomial of grade 3
         * @param {number} i Index 
         * @param {number} t Curve parameter
         * @returns {number} The value
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

        /**
         * Applies the deCasteljau algorithm to the given set of points
         * @param {number} t Curve parameter 
         * @param  {...THREE.Vector3} points The points
         * @returns {THREE.Vector3} The computed point 
         */
        static deCasteljau(t, ...points) {
            let result = [];
            for (let i = 0; i < points.length - 1; i++) {
                result.push(new THREE.Vector3().copy(points[i]).lerp(points[i + 1], t));
            }
            return result;
        }

        /**
         * Subdivides a curve into 2 curves.
         * @param {*} t Curve parameter 
         * @param  {...THREE.Vector3} points The points of the curve
         * @returns {[Vector3[], Vector3[]]} 2 arrays of points containing the 2 curves
         */
        static subdivideCurve(t, ...points) {

            points = points.map(p => new THREE.Vector3(p.x, p.y, p.z));

            let c0 = [points[0].clone()];
            let c1 = [points[points.length - 1].clone()];

            let done = false;

            while (!done) {
                points = this.deCasteljau(t, ...points);

                c0.push(points[0].clone());
                c1.splice(0, 0, points[points.length - 1].clone());

                done = points.length === 1;

            }

            return [c0, c1];

        }

    }

    /**
     * A Bezier curve of grade 3
     */
    class BezierCurve3 {
        /**
         * @constructor
         * @param  {...THREE.Vector3} pts The points
         */
        constructor(...pts) {
            if (pts.length !== 4)
                throw new Error("4 points are required for a bezier curve");
            this.points = pts;
        }
        /**
         * Computes the curve derivative
         * @param {number} t The curve parameter
         * @returns {THREE.Vector3} The result
         */
        derivative(t) {
            let result = buffers.vec3[0].set(0, 0, 0);
            let v = buffers.vec3[1];

            for (let i = 0; i < this.points.length; i++)
                result.add(v.copy(this.points[i]).multiplyScalar(Util.computeBernsetinDerivative3(i, t)));

            return result;
        }

        /**
         * Computes the curve at the given point
         * @param {number} t The curve parameter
         * @returns The calculated curve
         */
        compute(t) {
            let result = buffers.vec3[0].set(0, 0, 0);
            let v = buffers.vec3[1];

            for (let i = 0; i < this.points.length; i++)
                result.add(v.copy(this.points[i]).multiplyScalar(Util.computeBernsteinBasis3(i, t)));

            return result;
        }
        /**
         * Subdivides this curve into 2 curves
         * @param {number} t The curve parameter 
         * @returns {BezierCurve3[2]} The resulting 2 curves
         */
        subdivide(t) {
            return Util.subdivideCurve(this.points).map(v => new BezierCurve3(v));
        }

    }

    /**
     * Defines a 2d domain for a patch
     */
    class Domain {
        /**
         * @constructor
         * @param {number} u0 Min u
         * @param {number} v0 Min V
         * @param {number} u1 Max U
         * @param {number} v1 Max V
         */
        constructor(u0, v0, u1, v1) {
            this.u0 = u0;
            this.u1 = u1;
            this.v0 = v0;
            this.v1 = v1;
        }

        /**
         * Checks if a point is contained in this domain
         * @param {number} u 
         * @param {number} v
         * @returns {boolean} true if the point is included in the domain, false otherwise 
         */
        contains(u, v) {
            return u >= this.u0 && u <= this.u1 && v >= this.v0 && v <= this.v1;
        }
    }

    /**
     * A control point with a corresponding dom element.
     */
    class ControlPoint extends THREE.Vector3 {

        /**
         * Creates a new control point and adds his dom element to the UI
         * @constructor
         * @param {BezierMeshProjection} ownerProjection An instance of BezierMeshProjection containing this control point
         * @param {number} [x] The x oordinate
         * @param {number} [y] The y coordinate
         * @param {number} [z] The z coordinate
         */
        constructor(ownerProjection, x, y, z) {
            super(x, y, z);
            this.ownerProjection = ownerProjection;
            this.domElement = document.createElement("div");
            this.parent = null;
            this.mirrorMode = false;
            this.create();
        }

        /**
         * Helper function to create a control point from a THREE.Vector3
         * @param {BezierMeshProjection} ownerProjection An instance of BezierMeshProjection containing the new control point
         * @param {THREE.Vector3} point The point to copy the coordinates from 
         * @returns {ControlPoint} The new control point
         */
        static fromVector(ownerProjection, point) {
            return new ControlPoint(ownerProjection, point.x, point.y, point.z);
        }

        set visible(v) {
            this.domElement.style.display = v ? "block" : "none";
        }

        get visible() {
            return this.domElement.style.display === "none";
        }


        /**
         * Sets this control point to mirror another control point
         * @param {ControlPoint} other The point to mirror
         * @param {ControlPoint} reference The reference point for mirroring
         */
        mirror(other, reference) {
            if (other && reference) {
                this.mirrorPoint = {
                    other: other,
                    reference: reference
                }
            } else {
                this.mirrorPoint = null;
            }
        }


        /**
         * Moves this control point by the given offset
         * @param {THREE.Vector3} offset The offset
         * @param {boolean} mirror Is mirror active?
         */
        moveBy(offset, mirror) {
            this.add(offset);

            if (mirror && this.mirrorPoint) {
                offset = buffers.vec3[0].copy(this.mirrorPoint.reference).sub(this);
                this.mirrorPoint.other.copy(this.mirrorPoint.reference).add(offset);
            }

        }
        /**
         * Updates this control point, moving the corresponding DOM element
         * to the correct position, and updates the CSS style
         */
        update() {
            let screenPos = this.ownerProjection.worldToScreen(this);

            let color = this.ownerProjection.selectedControlPoints.includes(this) ?
                this.ownerProjection.options.secondaryColor : this.ownerProjection.options.primaryColor;

            this.domElement.style.left = (screenPos.x - this.ownerProjection.computedControlPointWidth / 2) + "px";
            this.domElement.style.top = (screenPos.y - this.ownerProjection.computedControlPointHeight / 2) + "px";
            this.domElement.style.backgroundColor = color;
        }

        /**
         * @private
         * Creates the DOM element associated with this control point
         */
        create() {
            this.domElement.classList.add("bm-handle");
            this.domElement.addEventListener("mousedown", (evt) => { evt.bmControlPoint = this; })
            this.domElement.addEventListener("mouseup", (evt) => { evt.bmControlPoint = this; })
            this.ownerProjection.container.appendChild(this.domElement);
        }


        /**
         * Detaches the DOM element associated with this control point
         */
        dispose() {
            if (this.domElement) {
                this.ownerProjection.container.removeChild(this.domElement);
                this.domElement = null;
            }
        }
        /**
         * Clone this control point
         * @returns {ControlPoint} A new control point equal to this
         */
        clone() {
            return new ControlPoint(this.ownerProjection, this.x, this.y, this.z);
        }

        /**
         * @returns {THREE.Vector3} A vector with the same position as this control poi
         */
        toVector3() {
            return new THREE.Vector3(this.x, this.y, this.z);
        }

    }

    /**
     * A composite patch
     */
    class Patch {
        /**
         * @constructor
         * @param {BezierMeshProjection} ownerProjection The projection holding this patch
         */
        constructor(ownerProjection) {
            this.ownerProjection = ownerProjection;
            this.dispose();
        }

        /**
         * Initializes this patch with a single bicubic bezier patch given
         * the 4 corners. The other control points are interpolated
         * @param {THREE.Vector3} topLeft Top left corner
         * @param {THREE.Vector3} topRight Top right corner
         * @param {THREE.Vector3} bottomLeft Bottom left corner
         * @param {THREE.Vector3} bottomRight Bottom right corner
         */
        initFromCorners(topLeft, topRight, bottomLeft, bottomRight) {

            let cp = new Array(16);

            let tl = cp[12] = ControlPoint.fromVector(this.ownerProjection, topLeft);
            let tr = cp[15] = ControlPoint.fromVector(this.ownerProjection, topRight);
            let bl = cp[0] = ControlPoint.fromVector(this.ownerProjection, bottomLeft);
            let br = cp[3] = ControlPoint.fromVector(this.ownerProjection, bottomRight);

            cp[1] = bl.clone().lerp(br, 1 / 3);
            cp[2] = bl.clone().lerp(br, 2 / 3);

            cp[13] = tl.clone().lerp(tr, 1 / 3);
            cp[14] = tl.clone().lerp(tr, 2 / 3);

            cp[4] = bl.clone().lerp(tl, 1 / 3);
            cp[8] = bl.clone().lerp(tl, 2 / 3);

            cp[7] = br.clone().lerp(tr, 1 / 3);
            cp[11] = br.clone().lerp(tr, 2 / 3);

            cp[5] = cp[0].clone().lerp(cp[15], 1 / 3);
            cp[10] = cp[0].clone().lerp(cp[15], 2 / 3);
            cp[9] = cp[12].clone().lerp(cp[3], 1 / 3);
            cp[6] = cp[12].clone().lerp(cp[3], 2 / 3);

            this.dispose();

            let initialBezierPatch = new BezierPatch3(this.ownerProjection, new Domain(0, 0, 1, 1), cp);
            this.bezierPatches = new Grid(1, 1);
            this.bezierPatches.set(0, 0, initialBezierPatch);

            this.relinkControlPoints();

        }

        /**
         * Disposes the resources associated with this patch
         */
        dispose() {
            if (this.bezierPatches)
                this.bezierPatches.forEach(p => p.dispose());
            this.bezierPatches = [];
        }

        /**
         * Recreates all the links for all the control points
         */
        relinkControlPoints() {
            for (let p of this.bezierPatches) {
                let cp = p.controlPoints;
                cp.forEach(cp => {
                    cp.mirror(null, null);
                });
            }

            for (let i = 0; i < this.bezierPatches.rowCount; i++) {
                for (let j = 0; j < this.bezierPatches.colCount; j++) {
                    let cur = this.bezierPatches.get(i, j);
                    let left = this.bezierPatches.get(i, j - 1);
                    let right = this.bezierPatches.get(i, j + 1);
                    let bottom = this.bezierPatches.get(i - 1, j);
                    let top = this.bezierPatches.get(i + 1, j);
                    let cp = cur.controlPoints;

                    if (left) {
                        cp[1].mirror(left.controlPoints[2], cp[0]);
                        cp[13].mirror(left.controlPoints[14], cp[12]);
                    }

                    if (right) {
                        cp[2].mirror(right.controlPoints[1], cp[3]);
                        cp[14].mirror(right.controlPoints[13], cp[15]);
                    }

                    if (bottom) {
                        cp[4].mirror(bottom.controlPoints[8], cp[0]);
                        cp[7].mirror(bottom.controlPoints[11], cp[3]);
                    }

                    if (top) {
                        cp[8].mirror(top.controlPoints[4], cp[12]);
                        cp[11].mirror(top.controlPoints[7], cp[15]);
                    }

                    if (!left && !bottom) {
                        cp[1].mirror(cp[4], cp[0]);
                        cp[4].mirror(cp[1], cp[0]);
                    }

                    if (!left && !top) {
                        cp[8].mirror(cp[13], cp[12]);
                        cp[13].mirror(cp[8], cp[12]);
                    }

                    if (!right && !top) {
                        cp[14].mirror(cp[11], cp[15]);
                        cp[11].mirror(cp[14], cp[15]);
                    }

                    if (!right && !bottom) {
                        cp[2].mirror(cp[7], cp[3]);
                        cp[7].mirror(cp[2], cp[3]);
                    }
                }
            }

        }

        /**
         * Serializes this patch data.
         * @returns {object} The serialized patch
         */
        save() {

            let ref = (p) => {
                if (!p["$ref"] === undefined)
                    throw new Error("Serialize error");
                return p["$ref"];
            }

            let serialize = (o) => {
                return JSON.parse(JSON.stringify(o));
            }

            // 1 . Set control points reference
            let refCount = 0;
            this.bezierPatches.forEach(patch => {
                for (let point of patch.controlPoints) {
                    point["$ref"] = refCount;
                    refCount++;
                }
            });

            let controlPoints = [];
            let patches = [];

            this.bezierPatches.forEach(patch => {

                let patchData = {
                    controlPoints: [],
                    domain: serialize(patch.domain)
                };

                for (let point of patch.controlPoints) {
                    let p = {
                        x: point.x,
                        y: point.y,
                        z: point.z,
                        mirrorPoint: point.mirrorPoint ?
                            { other: ref(point.mirrorPoint.other), reference: ref(point.mirrorPoint.reference) } :
                            null
                    }
                    controlPoints.push(p);
                    patchData.controlPoints.push(ref(point));
                }

                patches.push(patchData);
            });

            return {
                rows: this.bezierPatches.rowCount,
                cols: this.bezierPatches.colCount,
                patches: patches,
                controlPoints: controlPoints
            }

        }

        /**
         * Restores a serialized patch
         * @param {object} savedInstance The serialized patch data
         */
        restore(savedInstance) {

            this.dispose();

            this.bezierPatches = new Grid(savedInstance.rows, savedInstance.cols);

            let controlPoints = savedInstance.controlPoints.map(p => {
                return new ControlPoint(this.ownerProjection, p.x, p.y, p.z);
            })

            for (let i = 0; i < controlPoints.length; i++) {
                let cpData = savedInstance.controlPoints[i];
                if (cpData.mirrorPoint) {
                    controlPoints[i].mirror(
                        controlPoints[cpData.mirrorPoint.other],
                        controlPoints[cpData.mirrorPoint.reference]
                    );
                }
            }

            let i = 0;
            for (let patchData of savedInstance.patches) {
                let cps = patchData.controlPoints.map(i => controlPoints[i]);
                let row = Math.floor(i / savedInstance.cols);
                let col = i % savedInstance.cols;
                this.bezierPatches.set(row, col, new BezierPatch3(
                    this.ownerProjection,
                    new Domain(patchData.domain.u0, patchData.domain.v0, patchData.domain.u1, patchData.domain.v1),
                    cps
                ));
                ++i;
            }

        }

        /**
         * Computes the value of this patch at the given coordinates
         * @param {number} u The u coordinate
         * @param {number} v The v coordinate
         * @param {"bezier"|"linear"} mode The computation mode
         * @returns {THREE.Vector3} The value of the patch
         */
        compute(u, v, mode) {
            for (let p of this.bezierPatches) {
                if (p.domain.contains(u, v))
                    return p.compute(u, v, mode);
            };
        }

        /**
         * Updates this patch
         */
        update() {
            this.bezierPatches.forEach(p => p.update());
        }

        /**
         * Subdivides this patch along the u coordinate
         * @param {number} u The u coordinate
         */
        subdivideVertical(u) {
            let colIndex = this.bezierPatches.columns().findIndex(r => r[0].domain.u0 <= u && r[0].domain.u1 >= u);
            let col = this.bezierPatches.columns()[colIndex];

            let leftPatches = [];
            let rightPatches = [];


            /* Subdivided curves
                                cut point
            d0 --------------------|--------------------- d1
                                   |
                                   |
            c0 --------------------|--------------------- c1
                                   |
                                   |
            b0 --------------------|--------------------- b1
                                   |
                                   |
            a0 --------------------|--------------------- a1

            */


            for (let i = 0; i < this.bezierPatches.rowCount; i++) {

                let cur = col[i];

                let localU = (u - cur.domain.u0) / (cur.domain.u1 - cur.domain.u0);

                let a = Util.subdivideCurve(localU, cur.controlPoints[0], cur.controlPoints[1], cur.controlPoints[2], cur.controlPoints[3]);
                let b = Util.subdivideCurve(localU, cur.controlPoints[4], cur.controlPoints[5], cur.controlPoints[6], cur.controlPoints[7]);
                let c = Util.subdivideCurve(localU, cur.controlPoints[8], cur.controlPoints[9], cur.controlPoints[10], cur.controlPoints[11]);
                let d = Util.subdivideCurve(localU, cur.controlPoints[12], cur.controlPoints[13], cur.controlPoints[14], cur.controlPoints[15]);


                let ptsLeft = new Array(16).fill(null);
                let ptsRight = new Array(16).fill(null);

                if (i > 0) {
                    ptsLeft[0] = leftPatches[i - 1].controlPoints[12];
                    ptsLeft[1] = leftPatches[i - 1].controlPoints[13];
                    ptsLeft[2] = leftPatches[i - 1].controlPoints[14];
                    ptsLeft[3] = leftPatches[i - 1].controlPoints[15];

                    ptsRight[0] = rightPatches[i - 1].controlPoints[12];
                    ptsRight[1] = rightPatches[i - 1].controlPoints[13];
                    ptsRight[2] = rightPatches[i - 1].controlPoints[14];
                    ptsRight[3] = rightPatches[i - 1].controlPoints[15];

                } else {
                    ptsLeft[0] = cur.controlPoints[0];
                    ptsLeft[1] = cur.controlPoints[1].copy(a[0][1]);
                    ptsLeft[2] = ControlPoint.fromVector(this.ownerProjection, a[0][2]);

                    ptsRight[3] = cur.controlPoints[3];
                    ptsRight[2] = cur.controlPoints[2].copy(a[1][2]);
                    ptsRight[1] = ControlPoint.fromVector(this.ownerProjection, a[1][1]);

                    ptsLeft[3] = ptsRight[0] = ControlPoint.fromVector(this.ownerProjection, a[1][0]);

                }

                ptsLeft[4] = cur.controlPoints[4];
                ptsLeft[8] = cur.controlPoints[8];
                ptsLeft[12] = cur.controlPoints[12];
                ptsLeft[13] = cur.controlPoints[13].copy(d[0][1]);
                ptsLeft[14] = ControlPoint.fromVector(this.ownerProjection, d[0][2]);

                ptsLeft[5] = cur.controlPoints[5].copy(b[0][1]);
                ptsLeft[9] = cur.controlPoints[6].copy(c[0][1]);
                ptsLeft[6] = ControlPoint.fromVector(this.ownerProjection, b[0][2]);
                ptsLeft[10] = ControlPoint.fromVector(this.ownerProjection, c[0][2]);

                ptsRight[7] = cur.controlPoints[7];
                ptsRight[11] = cur.controlPoints[11];
                ptsRight[15] = cur.controlPoints[15];
                ptsRight[14] = cur.controlPoints[14].copy(d[1][2]);
                ptsRight[13] = ControlPoint.fromVector(this.ownerProjection, d[1][1]);

                ptsRight[5] = ControlPoint.fromVector(this.ownerProjection, b[1][1]);
                ptsRight[9] = ControlPoint.fromVector(this.ownerProjection, c[1][1]);
                ptsRight[6] = cur.controlPoints[9].copy(b[1][2]);
                ptsRight[10] = cur.controlPoints[10].copy(c[1][2]);

                ptsLeft[7] = ptsRight[4] = ControlPoint.fromVector(this.ownerProjection, b[1][0]);
                ptsLeft[11] = ptsRight[8] = ControlPoint.fromVector(this.ownerProjection, c[1][0]);
                ptsLeft[15] = ptsRight[12] = ControlPoint.fromVector(this.ownerProjection, d[1][0]);

                leftPatches.push(new BezierPatch3(
                    this.ownerProjection,
                    new Domain(cur.domain.u0, cur.domain.v0, u, cur.domain.v1),
                    ptsLeft
                ));

                rightPatches.push(new BezierPatch3(
                    this.ownerProjection,
                    new Domain(u, cur.domain.v0, cur.domain.u1, cur.domain.v1),
                    ptsRight
                ));
            }

            this.bezierPatches.insertColumn(colIndex + 1);
            this.bezierPatches.insertColumn(colIndex + 2);

            for (let i = 0; i < this.bezierPatches.rowCount; i++) {
                this.bezierPatches.set(i, colIndex + 1, leftPatches[i]);
                this.bezierPatches.set(i, colIndex + 2, rightPatches[i]);
            }

            this.bezierPatches.deleteColumn(colIndex);

            this.relinkControlPoints();
        }

        /**
         * Subdivides this patch along the v coordinate
         * @param {number} v The v coordinate
         */
        subdivideHorizontal(v) {
            let rowIndex = this.bezierPatches.rows().findIndex(r => r[0].domain.v0 <= v && r[0].domain.v1 >= v);
            let row = this.bezierPatches.rows()[rowIndex];

            let topPatches = [];
            let bottomPatches = [];


            /* Subdivided curves
            a1      b1      c1      d1
            |       |       |       |
            |       |       |       |
            |       |       |       |
            |       |       |       |
            |       |       |       |
            ---------------------------- cut point
            |       |       |       |
            |       |       |       |
            |       |       |       |
            |       |       |       |
            |       |       |       |
            a0      b0      c0      d0

            */


            for (let j = 0; j < this.bezierPatches.colCount; j++) {

                let cur = row[j];

                let localV = (v - cur.domain.v0) / (cur.domain.v1 - cur.domain.v0);

                let a = Util.subdivideCurve(localV, cur.controlPoints[0], cur.controlPoints[4], cur.controlPoints[8], cur.controlPoints[12]);
                let b = Util.subdivideCurve(localV, cur.controlPoints[1], cur.controlPoints[5], cur.controlPoints[9], cur.controlPoints[13]);
                let c = Util.subdivideCurve(localV, cur.controlPoints[2], cur.controlPoints[6], cur.controlPoints[10], cur.controlPoints[14]);
                let d = Util.subdivideCurve(localV, cur.controlPoints[3], cur.controlPoints[7], cur.controlPoints[11], cur.controlPoints[15]);


                let ptsTop = new Array(16).fill(null);
                let ptsBottom = new Array(16).fill(null);

                if (j > 0) {
                    ptsBottom[0] = bottomPatches[j - 1].controlPoints[3];
                    ptsBottom[4] = bottomPatches[j - 1].controlPoints[7];
                    ptsBottom[8] = bottomPatches[j - 1].controlPoints[11];
                    ptsBottom[12] = bottomPatches[j - 1].controlPoints[15];

                    ptsTop[0] = topPatches[j - 1].controlPoints[3];
                    ptsTop[4] = topPatches[j - 1].controlPoints[7];
                    ptsTop[8] = topPatches[j - 1].controlPoints[11];
                    ptsTop[12] = topPatches[j - 1].controlPoints[15];

                } else {
                    ptsBottom[0] = cur.controlPoints[0];
                    ptsBottom[4] = cur.controlPoints[4].copy(a[0][1]);
                    ptsBottom[8] = ControlPoint.fromVector(this.ownerProjection, a[0][2]);

                    ptsTop[12] = cur.controlPoints[12];
                    ptsTop[8] = cur.controlPoints[8].copy(a[1][2]);
                    ptsTop[4] = ControlPoint.fromVector(this.ownerProjection, a[1][1]);

                    ptsBottom[12] = ptsTop[0] = ControlPoint.fromVector(this.ownerProjection, a[1][0]);

                }

                ptsBottom[1] = cur.controlPoints[1];
                ptsBottom[2] = cur.controlPoints[2];
                ptsBottom[3] = cur.controlPoints[3];
                ptsBottom[7] = cur.controlPoints[7].copy(d[0][1]);
                ptsBottom[11] = ControlPoint.fromVector(this.ownerProjection, d[0][2]);

                ptsBottom[5] = cur.controlPoints[5].copy(b[0][1]);
                ptsBottom[6] = cur.controlPoints[6].copy(c[0][1]);
                ptsBottom[9] = ControlPoint.fromVector(this.ownerProjection, b[0][2]);
                ptsBottom[10] = ControlPoint.fromVector(this.ownerProjection, c[0][2]);

                ptsTop[13] = cur.controlPoints[13];
                ptsTop[14] = cur.controlPoints[14];
                ptsTop[15] = cur.controlPoints[15];
                ptsTop[11] = cur.controlPoints[11].copy(d[1][2]);
                ptsTop[7] = ControlPoint.fromVector(this.ownerProjection, d[1][1]);

                ptsTop[5] = ControlPoint.fromVector(this.ownerProjection, b[1][1]);
                ptsTop[6] = ControlPoint.fromVector(this.ownerProjection, c[1][1]);
                ptsTop[9] = cur.controlPoints[9].copy(b[1][2]);
                ptsTop[10] = cur.controlPoints[10].copy(c[1][2]);

                ptsBottom[13] = ptsTop[1] = ControlPoint.fromVector(this.ownerProjection, b[1][0]);
                ptsBottom[14] = ptsTop[2] = ControlPoint.fromVector(this.ownerProjection, c[1][0]);
                ptsBottom[15] = ptsTop[3] = ControlPoint.fromVector(this.ownerProjection, d[1][0]);

                bottomPatches.push(new BezierPatch3(
                    this.ownerProjection,
                    new Domain(cur.domain.u0, cur.domain.v0, cur.domain.u1, v),
                    ptsBottom
                ));

                topPatches.push(new BezierPatch3(
                    this.ownerProjection,
                    new Domain(cur.domain.u0, v, cur.domain.u1, cur.domain.v1),
                    ptsTop
                ));
            }

            this.bezierPatches.inserRow(rowIndex + 1);
            this.bezierPatches.inserRow(rowIndex + 2);

            for (let j = 0; j < this.bezierPatches.colCount; j++) {
                this.bezierPatches.set(rowIndex + 1, j, bottomPatches[j]);
                this.bezierPatches.set(rowIndex + 2, j, topPatches[j]);
            }

            this.bezierPatches.deleteRow(rowIndex);

            this.relinkControlPoints();

        }

    }

    /**
     * A bicubic bezier patch
     */
    class BezierPatch3 {
        /**
         * @constructor
         * @param {BezierMeshProjection} ownerProjection The projection owning this patch
         * @param {Domain} domain The patch's domain
         * @param {ControlPoint[16]} controlPoints The patch's control points
         */
        constructor(ownerProjection, domain, controlPoints) {
            this.ownerProjection = ownerProjection;
            this.controlPoints = controlPoints;
            this.domain = domain;
        }

        /**
         * Computes this patch at the given coordinates
         * @param {number} u The u coordinate
         * @param {number} v The v coordinate
         * @param {"linear"|"bezier"} mode The computation mode
         * @returns {THREE.Vector3} The value of the patch
         */
        compute(u, v, mode) {

            u = (u - this.domain.u0) / (this.domain.u1 - this.domain.u0);
            v = (v - this.domain.v0) / (this.domain.v1 - this.domain.v0);

            if (mode === "linear") {
                let v0 = buffers.vec3[0].copy(this.controlPoints[0]);
                let v1 = buffers.vec3[1].copy(this.controlPoints[12]);

                v0.lerp(this.controlPoints[3], u);
                v1.lerp(this.controlPoints[15], u);

                return v0.lerp(v1, v);
            } else if (mode === "bezier") {
                let pRes = buffers.vec3[0].set(0, 0, 0);
                let p0 = buffers.vec3[1];

                for (let y = 0; y < 4; y++) {
                    for (let x = 0; x < 4; x++) {
                        let b = Util.computeBernsteinBasis3(x, u) * Util.computeBernsteinBasis3(y, v);
                        pRes.add(p0.copy(this.controlPoints[y * 4 + x]).multiplyScalar(b));
                    }
                }
                return pRes;

            } else {
                throw new Error("Invalid patch compute mode: " + mode);
            }
        }

        /**
         * Updates this patch
         */
        update() {
            // Compute middle control points
            let cp = this.controlPoints;
            const mode = this.ownerProjection.options.mode;

            cp.forEach(p => p.visible = false);

            if (!this.ownerProjection.previewMode) {
                if (mode === "linear") {
                    cp[0].visible = true;
                    cp[3].visible = true;
                    cp[12].visible = true;
                    cp[15].visible = true;


                    // Autocompute outline CPS

                    cp[1].copy(cp[0]).lerp(cp[3], 1 / 3);
                    cp[2].copy(cp[0]).lerp(cp[3], 2 / 3);

                    cp[4].copy(cp[0]).lerp(cp[12], 1 / 3);
                    cp[8].copy(cp[0]).lerp(cp[12], 2 / 3);

                    cp[13].copy(cp[12]).lerp(cp[15], 1 / 3);
                    cp[14].copy(cp[12]).lerp(cp[15], 2 / 3);

                    cp[7].copy(cp[3]).lerp(cp[15], 1 / 3);
                    cp[11].copy(cp[3]).lerp(cp[15], 2 / 3);



                    // Auto compute mid points

                    cp[5].copy(cp[4]).lerp(cp[7], 1 / 3);
                    cp[6].copy(cp[4]).lerp(cp[7], 2 / 3);
                    cp[9].copy(cp[8]).lerp(cp[11], 1 / 3);
                    cp[10].copy(cp[8]).lerp(cp[11], 2 / 3);

                } else if (mode === "bezier") { // bezier
                    cp.forEach(p => p.visible = true);
                } else {
                    throw new Error("Invalid patch mode: " + this.ownerProjection.options.mode);
                }
            }


            cp.forEach(p => p.update());


        }

        /**
         * Releases all the resources associated with this patch
         */
        dispose() {
            this.controlPoints.forEach(p => p.dispose());
        }

    }

    /**
     * Creates a new instance
     * @constructor
     * @param {object} options
     * @param {string} options.container The selector for the canvas container
     * @param {number} [options.gridWidth] The number of subdivisions in the x-direction
     * @param {number} [options.gridHeight] The number of subdivisions in the y-direction
     * @param {string} [options.gridColor] Color used for grid lines and grid points.
     * @param {string} [options.primaryColor] Primary UI color
     * @param {string} [options.secondaryColor] Secondary UI color
     * @param {"bezier"|"linear"} [options.mode] Interpolation mode
     * @param {string} [options.texture] The url of the texture to be used
     * @param {string} [options.background] The image to be placed in the background
     */
    class BezierMeshProjection {
        constructor(options) {

            this.options = {
                container: null,
                gridWidth: 20,
                gridHeight: 20,

                gridColor: "#666666",

                primaryColor: "#0088ff",
                secondaryColor: "#ffcc00",

                mode: "bezier",
                texture: null,
                background: null,
            }

            this.initialize(options.container);
            this.reset(640, 640, 1024, 768);
            this.configure(options);
            this.loop();
        }


        set zoom(value) {
            let prevMouseWorld = this.mouse.world.clone();

            this.zoomValue = value;
            this.updateProjectionMatrix();

            prevMouseWorld.sub(this.screenToWorld(this.mouse.position.x, this.mouse.position.y))

            this.cameraOrigin.add(prevMouseWorld);

        }

        get zoom() {
            return this.zoomValue;
        }


        /**
         * Saves the current patch so it can be restored later
         * @returns {object} The current patch
         */
        save() {
            return {
                backgroundWidth: this.backgroundWidth,
                backgroundHeight: this.backgroundHeight,
                options: {
                    texture: this.options.texture,
                    backgorund: this.options.background,
                    gridWidth: this.options.gridWidth,
                    gridHeight: this.options.gridHeight,
                    mode: this.options.mode
                },
                patchData: this.patch.save()
            }
        }

        /**
         * Restores the given saved patch
         * @param {object} savedInstance The patch to be restored
         */
        restore(savedInstance) {
            this.reset(1, 1, savedInstance.backgroundWidth, savedInstance.backgroundHeight);
            this.patch.restore(savedInstance.patchData);
            this.configure(savedInstance.options);
            this.createHistory();
        }

        /**
         * Exports the current mesh (plane only) in GLTF format. The result will also include
         * some custom data:
         * - bm_MeshCorners: the main 4 corners of the mesh
         * @returns {object} The GLTF data
         */
        export() {
            return new Promise((resolve, reject) => {
                new THREE.GLTFExporter().parse(this.meshes.plane, (data) => {

                    let patches = this.patch.bezierPatches;
                    let rows = patches.rowCount;
                    let cols = patches.colCount;

                    data.bm_MeshCorners = {
                        topLeft: patches.get(rows - 1, 0).controlPoints[12].toVector3(),
                        topRight: patches.get(rows - 1, cols - 1).controlPoints[15].toVector3(),
                        bottomRight: patches.get(0, cols - 1).controlPoints[3].toVector3(),
                        bottomLeft: patches.get(0, 0).controlPoints[0].toVector3(),
                    }
                    resolve(data);
                });
            });
        }


        /**
         * Resets the patch and the background plane
         * @param {number} patchWidth Patch width in pixels
         * @param {number} patchHeight Patch height in pixels
         * @param {number} backgroundWidth Background width in pixels
         * @param {number} backgroundHeight Background height in pixels
         */
        reset(patchWidth, patchHeight, backgroundWidth, backgroundHeight) {
            this.backgroundWidth = backgroundWidth;
            this.backgroundHeight = backgroundHeight;
            this.patchWidth = patchWidth;
            this.patchHeight = patchHeight;

            // Create initial patch
            {

                let bl = buffers.vec3[0].set((backgroundWidth - patchWidth) / 2, (backgroundHeight - patchHeight) / 2);
                let br = buffers.vec3[1].set((backgroundWidth - patchWidth) / 2 + patchWidth, (backgroundHeight - patchHeight) / 2);
                let tl = buffers.vec3[2].set((backgroundWidth - patchWidth) / 2, (backgroundHeight - patchHeight) / 2 + patchHeight);
                let tr = buffers.vec3[3].set((backgroundWidth - patchWidth) / 2 + patchWidth, (backgroundHeight - patchHeight) / 2 + patchHeight);

                this.patch.initFromCorners(tl, tr, bl, br);
            }


            // Reset the camera
            this.cameraOrigin.set(0, 0);

            // Reset history and create initial state
            this.createHistory();

            return this;
        }

        /**
         * Change the current configuration.
         * @param {object} options
         * @param {number} [options.gridWidth] The number of subdivisions in the x-direction
         * @param {number} [options.gridHeight] The number of subdivisions in the y-direction
         * @param {string} [options.gridColor] Color used for grid lines and grid points.
         * @param {string} [options.primaryColor] Primary UI color
         * @param {string} [options.secondaryColor] Secondary UI color
         * @param {"bezier"|"linear"} [options.mode] Interpolation mode
         * @param {string} [options.texture] The url of the texture to be used
         * @param {string} [options.background] The image to be placed in the background
         */
        configure(options) {

            Object.assign(this.options, options);


            let gw = this.options.gridWidth + 1;
            let gh = this.options.gridHeight + 1;

            this.meshes = {};

            // Initialize three.js scene

            this.scene = new THREE.Scene();
            this.camera = new THREE.OrthographicCamera(-1, 1, -1, 1, -1, 1);

            // Init grid points buffer;
            this.gridPoints = new Array(gw * gh);
            for (let i = 0; i < this.gridPoints.length; i++)
                this.gridPoints[i] = new THREE.Vector3();

            // Create background plane
            {

                let planeGeom = new THREE.PlaneGeometry();

                this.meshes.backgroundPlane = new THREE.Mesh(planeGeom, new THREE.MeshBasicMaterial({ color: 0xffffff }));

                this.scene.add(this.meshes.backgroundPlane);

                this.textures.load(this.options.background).then(tex => {
                    this.meshes.backgroundPlane.material.map = tex;
                    this.meshes.backgroundPlane.material.needsUpdate = true;
                });

            }

            // Create plane mesh
            {

                // Indices
                let indices = [];

                for (let y = 0; y < gh - 1; y++) {
                    for (let x = 0; x < gw - 1; x++) {
                        let a = y * gw + x;
                        let b = y * gw + x + 1;
                        let c = (y + 1) * gw + x;
                        let d = (y + 1) * gw + x + 1;

                        indices.push(a, b, c);
                        indices.push(b, d, c);

                    }
                }

                // Normals
                let normals = [];
                for (let i = 0; i < gw * gh; i++)
                    normals.push(0, 0, 1);

                // UVs
                let uvs = [];

                for (let y = 0; y < gh; y++) {
                    for (let x = 0; x < gw; x++) {
                        uvs.push(x / (gw - 1), y / (gh - 1));
                    }
                }

                let planeGeom = new THREE.BufferGeometry();

                planeGeom.addAttribute("position", new THREE.BufferAttribute(new Float32Array(gw * gh * 3), 3));
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


            // Create grid lines mesh
            {
                let indices = [];

                // Horizontal lines
                for (let y = 0; y < gh; y++) {
                    for (let x = 0; x < gw - 1; x++) {
                        indices.push(y * gw + x, y * gw + x + 1);
                    }
                }

                // Vertical lines
                for (let x = 0; x < gw; x++) {
                    for (let y = 0; y < gh - 1; y++) {
                        indices.push(y * gw + x, (y + 1) * gw + x);
                    }
                }

                let linesGeom = new THREE.BufferGeometry();

                linesGeom.addAttribute("position", new THREE.BufferAttribute(new Float32Array(gw * gh * 3), 3));
                linesGeom.setIndex(indices);

                this.meshes.gridLines = new THREE.LineSegments(linesGeom, new THREE.LineBasicMaterial({
                    color: this.options.gridColor,
                    opacity: 0.5,
                    transparent: true
                }));
                this.scene.add(this.meshes.gridLines);

            }



            this.meshes.gridLines.visible = !this.previewMode;


            this.reshape();

        }

        /**
         * Called after the component is constructed.
         * @private
         */
        initialize(container) {

            // Main container
            this.container = document.querySelector(container);

            // Preview mode
            this.previewMode = false;

            // Selected tool
            this.selectedTool = Tools.Arrow;

            // Zoom
            this.zoomValue = 1;

            // Init mouse info
            this.mouse = {
                position: new THREE.Vector3(),
                ndc: new THREE.Vector3(),
                world: new THREE.Vector3(),
                prev: {
                    position: new THREE.Vector3(),
                    ndc: new THREE.Vector3(),
                    world: new THREE.Vector3()
                },
                leftButtonDown: false,
                rightButtonDown: false
            };

            // Key state info
            this.keystate = {};

            this.cameraOrigin = new THREE.Vector3();


            // Init three.js renderer
            this.renderer = new THREE.WebGLRenderer({ antialias: true });
            this.textures = new Textures();
            this.raycaster = new THREE.Raycaster();

            // Create initial patch
            this.patch = new Patch(this);


            // Selected control points
            this.selectedControlPoints = [];

            // 3D renderer
            this.container.appendChild(this.renderer.domElement);


            // UI Canvas
            {
                let uiCanvas = document.createElement("canvas");
                uiCanvas.style.position = "absolute";
                uiCanvas.style.left = "0px";
                uiCanvas.style.top = "0px";

                this.uiCanvas = uiCanvas;

            }
            this.container.appendChild(this.uiCanvas);

            // Event handlers
            this.container.addEventListener("mouseleave", this.mouseleave.bind(this));
            this.container.addEventListener("mousemove", this.mousemove.bind(this));
            this.container.addEventListener("mousedown", this.mousedown.bind(this));
            this.container.addEventListener("mouseup", this.mouseup.bind(this));
            this.container.addEventListener("click", this.click.bind(this));
            this.container.addEventListener("contextmenu", (evt) => evt.preventDefault());

            window.addEventListener("resize", this.reshape.bind(this));
            window.addEventListener("keydown", this.keydown.bind(this));
            window.addEventListener("keyup", this.keyup.bind(this));

        }

        /**
         * Creates the history and initializes it with the current patch data
         * @private
         */
        createHistory() {
            this.history = new History();
            this.saveHistory();
        }

        /**
         * Restores the current history element
         */
        restoreHistory() {
            let current = this.history.current();
            this.patch.restore(current.patchData);
        }

        /**
         * Pushes the current patch data into the history stack
         */
        saveHistory() {
            this.history.insert({ patchData: this.patch.save() });
        }

        /**
         * Updates UI
         * @private
         */
        updateUI() {

            // Do not draw UI in previewMode
            if (this.previewMode)
                return;

            // Compute control point size for optimization
            {
                let cpElement = document.querySelector(".bm-handle");
                this.computedControlPointWidth = cpElement ? cpElement.clientWidth : 0;
                this.computedControlPointHeight = cpElement ? cpElement.clientHeight : 0;
            }

            let ctx = this.uiCanvas.getContext("2d");
            let [w, h] = [this.uiCanvas.width, this.uiCanvas.height];
            ctx.clearRect(0, 0, w, h);

            let setShadow = () => {
                ctx.shadowOffsetX = ctx.shadowOffsetY = 1;
                ctx.shadowColor = "rgba(0,0,0,0.25)";
            }

            // Draw patches outline

            ctx.save();
            {
                ctx.strokeStyle = this.options.primaryColor;
                ctx.lineWidth = 2;
                setShadow();


                for (let patch of this.patch.bezierPatches) {
                    let cps = patch.controlPoints;
                    let vertices = this.options.mode === "bezier" ?
                        [
                            cps[0], cps[1], cps[2], cps[3],
                            cps[7], cps[11], cps[15], cps[14],
                            cps[13], cps[12], cps[8], cps[4]
                        ] :
                        [
                            cps[0], cps[3], cps[15], cps[12]
                        ];

                    ctx.beginPath();
                    for (let i = 0; i < vertices.length; i++) {
                        let p = this.worldToScreen(vertices[i]);
                        i == 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
                    }
                    ctx.closePath();
                    ctx.stroke();

                }
            }
            ctx.restore();




            // Draw patches interior
            if (this.options.mode === "bezier") {
                ctx.save();
                {
                    let u0 = new THREE.Vector2();
                    let u1 = new THREE.Vector2();
                    let v0 = new THREE.Vector2();
                    let v1 = new THREE.Vector2();

                    ctx.lineWidth = 1;
                    ctx.globalAlpha = 0.5;
                    ctx.strokeStyle = this.options.primaryColor;

                    for (let patch of this.patch.bezierPatches) {

                        let cps = patch.controlPoints;

                        for (let i = 0; i < 3; i++) {
                            for (let j = 1; j < 3; j++) {
                                // Horizontal
                                u0.copy(this.worldToScreen(cps[j * 4 + i]));
                                u1.copy(this.worldToScreen(cps[j * 4 + i + 1]));

                                ctx.beginPath();
                                ctx.moveTo(u0.x, u0.y)
                                ctx.lineTo(u1.x, u1.y);
                                ctx.stroke();

                                // Vertical
                                v0.copy(this.worldToScreen(cps[i * 4 + j]));
                                v1.copy(this.worldToScreen(cps[(i + 1) * 4 + j]));

                                ctx.beginPath();
                                ctx.moveTo(v0.x, v0.y)
                                ctx.lineTo(v1.x, v1.y);
                                ctx.stroke();

                            }
                        }

                    }

                }
                ctx.restore();
            }

            // Horizontal or vertical cut
            ctx.save();
            {

                ctx.strokeStyle = this.options.secondaryColor;
                ctx.setLineDash([10]);
                ctx.lineWidth = 2;
                setShadow();

                if (this.selectedTool === Tools.VerticalCut || this.selectedTool === Tools.HorizontalCut) {
                    let horizontal = this.selectedTool === Tools.HorizontalCut;
                    let uv = this.intersectMesh(this.mouse.ndc);
                    if (uv) {
                        ctx.beginPath();

                        for (let i = 0; i <= (horizontal ? this.options.gridWidth : this.options.gridHeight); i++) {
                            let point = this.patch.compute(
                                horizontal ? i / this.options.gridWidth : uv.x,
                                horizontal ? uv.y : i / this.options.gridHeight,
                                this.options.mode
                            );

                            let screenPos = this.worldToScreen(point);

                            i == 0 ? ctx.moveTo(screenPos.x, screenPos.y) : ctx.lineTo(screenPos.x, screenPos.y);

                        }
                        ctx.stroke();
                    }
                }
            }
            ctx.restore();

            // Draw selection rect
            ctx.save();
            {
                if (this.selectionRect) {
                    ctx.strokeStyle = ctx.fillStyle = this.options.secondaryColor;
                    ctx.lineJoin = "round";
                    ctx.globalAlpha = 0.2;
                    ctx.fillRect(
                        this.selectionRect.min.x,
                        this.selectionRect.min.y,
                        this.selectionRect.max.x - this.selectionRect.min.x,
                        this.selectionRect.max.y - this.selectionRect.min.y
                    );
                    ctx.globalAlpha = 1;
                    ctx.strokeRect(
                        this.selectionRect.min.x,
                        this.selectionRect.min.y,
                        this.selectionRect.max.x - this.selectionRect.min.x,
                        this.selectionRect.max.y - this.selectionRect.min.y
                    );
                }

            }
            ctx.restore();




        }

        /**
         * Aligns the selected control points to the given direction
         * @param {"left"|"right"|"top"|"bottom"} direction The alignment direction
         */
        alignSelectedPoints(direction) {
            if (this.selectedControlPoints.length < 2)
                return;
            if (direction === "left") {
                let x = Math.min(...this.selectedControlPoints.map(c => c.x));
                this.selectedControlPoints.forEach(e => e.x = x);
                this.saveHistory();
            } else if (direction === "right") {
                let x = Math.max(...this.selectedControlPoints.map(c => c.x));
                this.selectedControlPoints.forEach(e => e.x = x);
                this.saveHistory();
            } else if (direction === "top") {
                let y = Math.max(...this.selectedControlPoints.map(c => c.y));
                this.selectedControlPoints.forEach(e => e.y = y);
                this.saveHistory();
            } else if (direction === "bottom") {
                let y = Math.min(...this.selectedControlPoints.map(c => c.y));
                this.selectedControlPoints.forEach(e => e.y = y);
                this.saveHistory();
            } else {
                throw new Error("Invalid alignment direction: " + direction);
            }
        }


        /**
         * Main loop
         * @private
         */
        loop() {
            window.requestAnimationFrame(this.loop.bind(this));

            this.updateProjectionMatrix();
            this.updatePatch();
            this.updateMeshes();
            this.updateUI();

            this.renderer.clearColor();

            this.renderer.render(this.scene, this.camera);
        }

        /**
         * Updates the patch
         * @private
         */
        updatePatch() {
            this.patch.update();
        }

        /**
         * Updates all the meshes
         * @private
         */
        updateMeshes() {

            const gw = this.options.gridWidth + 1;
            const gh = this.options.gridHeight + 1;

            // Compute grid points
            {
                for (let x = 0; x < gw; x++) {
                    for (let y = 0; y < gh; y++) {
                        let point = this.patch.compute(x / (gw - 1), y / (gh - 1), this.options.mode);
                        this.gridPoints[y * gw + x].copy(point);
                    }
                }
            }

            // Update background plane 
            if (this.meshes.backgroundPlane) {
                let geom = this.meshes.backgroundPlane.geometry;

                geom.vertices[0].set(0, this.backgroundHeight, -0.1);
                geom.vertices[1].set(this.backgroundWidth, this.backgroundHeight, -0.1);
                geom.vertices[2].set(0, 0, -0.1);
                geom.vertices[3].set(this.backgroundWidth, 0, -0.1);

                geom.verticesNeedsUpdate = true;

            }


            // Update meshes
            {
                let linesPositions = this.meshes.gridLines.geometry.attributes.position;
                let planePositions = this.meshes.plane.geometry.attributes.position;

                for (let x = 0; x < gw; x++) {
                    for (let y = 0; y < gh; y++) {
                        let idx = y * gw + x;
                        let bufIdx = idx * 3;

                        linesPositions.array[bufIdx + 0] = planePositions.array[bufIdx + 0] = this.gridPoints[idx].x;
                        linesPositions.array[bufIdx + 1] = planePositions.array[bufIdx + 1] = this.gridPoints[idx].y;
                        linesPositions.array[bufIdx + 2] = 0.01;
                        planePositions.array[bufIdx + 2] = 0;
                    }
                }

                linesPositions.needsUpdate = true;
                planePositions.needsUpdate = true;

            }


        }

        /**
         * Updates the projection matrix
         * @private
         */
        updateProjectionMatrix() {
            let [w, h] = [this.container.clientWidth, this.container.clientHeight];
            let a = w / h;

            if (this.zoomValue < 1) {
                this.zoomValue = 1;
            }

            let z = 1 / this.zoomValue;

            let minY = -this.backgroundHeight;
            let maxY = this.backgroundHeight * 2;

            let s = (3 * this.backgroundHeight * a - this.backgroundWidth) / 2;

            let minX = -s;
            let maxX = s + this.backgroundWidth;

            let left = this.cameraOrigin.x;
            let right = this.cameraOrigin.x + a * z * (maxY - minY);
            let bottom = this.cameraOrigin.y;
            let top = + this.cameraOrigin.y + z * (maxY - minY);

            let offsetX = 0, offsetY = 0;
            if (left < minX) {
                offsetX = minX - left;
            } else if (right > maxX) {
                offsetX = maxX - right;
            }

            if (bottom < minY) {
                offsetY = minY - bottom;
            } else if (top > maxY) {
                offsetY = maxY - top;
            }

            left += offsetX;
            right += offsetX;
            top += offsetY;
            bottom += offsetY;

            this.cameraOrigin.x = left;
            this.cameraOrigin.y = bottom;


            this.camera.left = left;
            this.camera.right = right;
            this.camera.bottom = bottom;
            this.camera.top = top;

            this.camera.near = -1;
            this.camera.far = 1;
            this.camera.updateProjectionMatrix();
        }


        /**
         * Undo the last command (goes back in history)
         */
        undo() {
            this.history.back();
            this.restoreHistory();
        }

        /**
         * Redo the last command (goes forward in history)
         */
        redo() {
            this.history.forward();
            this.restoreHistory();
        }

        /**
         * Updates the size of the renderer and the projection matrix
         * @private
         */
        reshape() {
            this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
            this.uiCanvas.width = this.container.clientWidth;
            this.uiCanvas.height = this.container.clientHeight;

            this.containerWidth = this.container.clientWidth;
            this.containerHeight = this.container.clientHeight;

            this.updateProjectionMatrix();
        }

        /**
         * Key down event handler
         * @private
         * @param {KeyEvent} evt The event
         */
        keydown(evt) {
            this.keystate[evt.code] = true;
        }

        /**
         * Key up event handles
         * @private
         * @param {KeyEvent} evt The event
         */
        keyup(evt) {
            delete this.keystate[evt.code];
        }

        /**
         * Tests if the mesh is intersected by the given ray
         * @private
         * @param {THREE.Vector3} ndc Normalized device coordinates
         */
        intersectMesh(ndc) {
            this.raycaster.setFromCamera(ndc, this.camera);
            let intersects = this.raycaster.intersectObject(this.meshes.plane);
            if (intersects.length === 1) {
                let u = intersects[0].uv.x;
                let v = intersects[0].uv.y;
                return new THREE.Vector2(u, v);
            }
            return null;

        }

        /**
         * Updates the mouse position and other info
         * @private
         * @param {MouseEvent} evt The event
         */
        updateMousePosition(evt) {
            let t = evt.target;
            let [mx, my] = [evt.offsetX, evt.offsetY];

            if (t !== this.renderer.domElement) {
                mx += t.offsetLeft
                my += t.offsetTop;
            }

            // Update global mouse position
            this.mouse.prev.ndc.copy(this.mouse.ndc);
            this.mouse.prev.position.copy(this.mouse.position);
            this.mouse.prev.world.copy(this.mouse.world);

            this.mouse.position.set(mx, my, 0);
            this.mouse.ndc.set(
                mx / this.container.clientWidth * 2 - 1,
                - (my / this.container.clientHeight) * 2 + 1,
                0
            )
            this.mouse.world.copy(this.screenToWorld(mx, my));

        }

        /**
         * Click event handler
         * @private
         * @param {MouseEvent} evt The event
         */
        click(evt) {

            this.updateMousePosition(evt);

            if (this.selectedTool === Tools.HorizontalCut) {
                let uv = this.intersectMesh(this.mouse.ndc);
                if (uv) {
                    this.patch.subdivideHorizontal(uv.y);
                    this.saveHistory();
                }
            }


            if (this.selectedTool === Tools.VerticalCut) {
                let uv = this.intersectMesh(this.mouse.ndc);
                if (uv) {
                    this.patch.subdivideVertical(uv.x);
                    this.saveHistory();
                }
            }
        }

        /**
         * Mouse leave event handler
         * @private
         * @param {MouseEvent} evt The event
         */
        mouseleave(evt) {
            this.mouse.leftButtonDown = false;
            this.mouse.rightButtonDown = false;
        }

        /**
         * Mouse down event handler
         * @private
         * @param {MouseEvent} evt The event
         */
        mousedown(evt) {

            this.mouse.leftButtonDown = evt.button === 0;
            this.mouse.rightButtonDown = evt.button === 2;
            this.updateMousePosition(evt);

            if (this.selectedTool === Tools.Arrow) {
                if (evt.bmControlPoint) {
                    let cp = evt.bmControlPoint;

                    if (!this.selectedControlPoints.includes(cp)) {
                        if (this.keystate["ShiftLeft"]) {
                            this.selectedControlPoints.push(cp);
                        } else {
                            this.selectedControlPoints = [cp];
                        }
                    }


                } else {
                    if (!this.keystate["ShiftLeft"])
                        this.selectedControlPoints = [];
                }
            }

            this.dragInfo = {
                position: new THREE.Vector3().copy(this.mouse.position),
                world: new THREE.Vector3().copy(this.screenToWorld(
                    this.mouse.position.x,
                    this.mouse.position.y
                )),
                patchData: this.patch.save(),
                controlPoint: !!evt.bmControlPoint
            }

            evt.preventDefault();
        }

        /**
         * Mouse move event handler
         * @private
         * @param {MouseEvent} evt The event
         */
        mousemove(evt) {
            this.updateMousePosition(evt);

            this.selectionRect = null;

            if (this.selectedTool === Tools.Arrow) {
                if (this.dragInfo && (this.mouse.leftButtonDown || this.mouse.rightButtonDown)) {
                    if (this.dragInfo.controlPoint) {
                        let offset = buffers.vec3[0].copy(this.mouse.world).sub(this.mouse.prev.world);
                        let mirror = this.mouse.rightButtonDown && this.selectedControlPoints.length == 1;
                        this.selectedControlPoints.forEach(c => c.moveBy(offset, mirror));
                    } else {
                        let p0 = this.dragInfo.position;
                        let p1 = this.mouse.position;
                        this.selectionRect = {
                            min: new THREE.Vector3(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), 0),
                            max: new THREE.Vector3(Math.max(p0.x, p1.x), Math.max(p0.y, p1.y), 0),
                        }
                    }
                }
            }

            if (this.selectedTool === Tools.Pan && this.mouse.leftButtonDown) {
                let offset = buffers.vec3[0].copy(this.dragInfo.world).sub(this.mouse.world);
                this.cameraOrigin.add(offset);
                this.updateProjectionMatrix();
            }

        }

        /**
         * Mouse up event handler
         * @private
         * @param {MouseEvent} evt The event
         */
        mouseup(evt) {

            this.mouse.leftButtonDown = false;
            this.mouse.rightButtonDown = false;
            this.updateMousePosition(evt);

            if (this.selectedTool === Tools.Arrow) {

                if (this.selectionRect) {
                    // Find all the control selected control points
                    let cps = [];

                    for (let patch of this.patch.bezierPatches) {
                        cps.push(...patch.controlPoints.filter(c => {

                            let pos = this.worldToScreen(c);
                            return !cps.includes(c) && pos.x >= this.selectionRect.min.x && pos.x <= this.selectionRect.max.x &&
                                pos.y >= this.selectionRect.min.y && pos.y <= this.selectionRect.max.y;
                        }));
                    }

                    if (this.keystate["ShiftLeft"]) {
                        this.selectedControlPoints.push(...cps.filter(c => !this.selectedControlPoints.includes(c)));
                    } else {
                        this.selectedControlPoints = cps;
                    }

                } else if (this.selectedControlPoints.length > 0) {
                    if (this.dragInfo.position.distanceTo(this.mouse.position) > 0) {
                        this.saveHistory();
                    }
                }
            }

            this.dragInfo = null;

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
            return buffers.vec2[0].set(
                (uv.x + 1) / 2 * this.containerWidth,
                this.containerHeight - (uv.y + 1) / 2 * this.containerHeight
            );
        }

    }

    exportObj[exportName] = {
        BezierMeshProjection: BezierMeshProjection
    }

})(window, "bm");

