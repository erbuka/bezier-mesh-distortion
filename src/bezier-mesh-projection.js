
(function (exportObj, exportName) {
    "use strict";

    // Temporary buffers (for memory reuse/efficency)
    let buffers = {};
    {
        buffers.vec3 = [];
        for (let i = 0; i < 16; i++)
            buffers.vec3.push(new THREE.Vector3());
    }

    class Grid {
        constructor(rows, cols) {
            this.rowCount = rows;
            this.colCount = cols;
            this.cells = new Array(rows * cols).fill(null);
        }

        [Symbol.iterator]() { return this.cells.values(); }

        forEach(predicate) {
            this.cells.forEach(predicate);
        }

        get(i, j) {
            if (i < 0 || i > this.rowCount - 1 || j < 0 || j > this.colCount - 1)
                return null;
            return this.cells[i * this.colCount + j];
        }

        set(i, j, v) {
            this.cells[i * this.colCount + j] = v;
        }

        deleteColumn(j) {
            for (let i = this.rowCount - 1; i >= 0; i--)
                this.cells.splice(i * this.colCount + j, 1);
            this.colCount--;
        }

        deleteRow(i) {
            this.cells.splice(i * this.colCount, this.colCount);
            this.rowCount--;
        }

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

        inserRow(index) {
            this.cells.splice(index * this.colCount, 0, ...new Array(this.colCount).fill(null));
            this.rowCount++;
        }

        insertColumn(index) {
            for (let i = 0; i < this.rowCount; i++)
                this.cells.splice(i * (this.colCount + 1) + index, 0, null);
            this.colCount++;
        }

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

    class History {
        constructor() {
            this.index = -1;
            this.data = [];
        }

        current() {
            return this.data[this.index];
        }

        insert(e) {
            this.index++;
            let deleteCount = Math.max(0, this.data.length - this.index);
            this.data.splice(this.index, deleteCount, e);
        }

        back() {
            this.index = Math.max(0, this.index - 1);
        }

        forward() {
            this.index = Math.min(this.data.length - 1, this.index + 1);
        }

    }

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

        static makeArray(size, ctor, ...args) {
            let r = new Array(size);
            for (let i = 0; i < size; i++)
                r[i] = new ctor(...args);
            return r;
        }

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

        static deCasteljau(t, ...points) {
            let result = [];
            for (let i = 0; i < points.length - 1; i++) {
                result.push(new THREE.Vector3().copy(points[i]).lerp(points[i + 1], t));
            }
            return result;
        }

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

    class BezierCurve3 {
        constructor(...pts) {
            if (pts.length !== 4)
                throw new Error("4 points are required for a bezier curve");
            this.points = pts;
        }

        derivative(t) {
            let result = buffers.vec3[0].set(0, 0, 0);
            let v = buffers.vec3[1];

            for (let i = 0; i < this.points.length; i++)
                result.add(v.copy(this.points[i]).multiplyScalar(Util.computeBernsetinDerivative3(i, t)));

            return result;
        }

        compute(t) {
            let result = buffers.vec3[0].set(0, 0, 0);
            let v = buffers.vec3[1];

            for (let i = 0; i < this.points.length; i++)
                result.add(v.copy(this.points[i]).multiplyScalar(Util.computeBernsteinBasis3(i, t)));

            return result;
        }

        subdivide(t) {
            return Util.subdivideCurve(this.points).map(v => new BezierCurve3(v));
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
            return u >= this.u0 && u <= this.u1 && v >= this.v0 && v <= this.v1;
        }
    }

    class ControlPoint extends THREE.Vector3 {
        constructor(ownerProjection, x, y, z) {
            super(x, y, z);
            this.ownerProjection = ownerProjection;
            this.domElement = document.createElement("div");
            this.parent = null;
            this.children = [];
            this.mirrorMode = false;
            this.create();
        }

        static fromVector(ownerProjection, point) {
            return new ControlPoint(ownerProjection, point.x, point.y, point.z);
        }

        addChildren(...children) {
            for (let c of children)
                if (!this.children.includes(c))
                    this.children.push(c);
            children.forEach(c => c.parent = this);
        }

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

        move(x, y) {
            let offset = this.ownerProjection.screenToWorld(x, y).sub(this);

            this.add(offset);

            this.children.forEach(c => c.add(offset));

            if (this.mirrorPoint && this.mirrorMode) {
                let offset = buffers.vec3[0].copy(this.mirrorPoint.reference).sub(this);
                this.mirrorPoint.other.copy(this.mirrorPoint.reference).add(offset);
            }

        }

        update() {
            let screenPos = this.ownerProjection.worldToScreen(this);
            let rect = this.domElement.getBoundingClientRect();
            this.domElement.style.left = (screenPos.x - rect.width / 2) + "px";
            this.domElement.style.top = (screenPos.y - rect.height / 2) + "px";
            this.domElement.style.backgroundColor = this.ownerProjection.options.handleColor;
            this.domElement.style.display = this.ownerProjection.options.preview ? "none" : null;
        }

        create() {
            this.domElement.classList.add("bm-handle");
            this.domElement.addEventListener("mousedown", (evt) => {
                this.ownerProjection.setSelectedHandle(this);
                this.mirrorMode = evt.button === 2;
                evt.preventDefault();
            })
            this.ownerProjection.container.appendChild(this.domElement);
        }

        dispose() {
            if (this.domElement) {
                this.ownerProjection.container.removeChild(this.domElement);
                this.domElement = null;
            }
        }

        clone() {
            return new ControlPoint(this.ownerProjection, this.x, this.y, this.z);
        }

        toVector3() {
            return new THREE.Vector3(this.x, this.y, this.z);
        }

    }

    class Patch {
        constructor(ownerProjection) {
            this.ownerProjection = ownerProjection;
            this.dispose();
        }

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

        dispose() {
            if (this.bezierPatches)
                this.bezierPatches.forEach(p => p.dispose());
            this.bezierPatches = null;
        }

        relinkControlPoints() {
            for (let p of this.bezierPatches) {
                let cp = p.controlPoints;
                cp.forEach(cp => {
                    cp.mirror(null, null);
                    cp.children.forEach(c => c.parent = null);
                    cp.children = [];
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

                    cp[0].addChildren(cp[1], cp[4], cp[5]);
                    cp[3].addChildren(cp[2], cp[7], cp[6]);
                    cp[12].addChildren(cp[8], cp[13], cp[9]);
                    cp[15].addChildren(cp[14], cp[11], cp[10]);

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
                        children: point.children.map(c => ref(c)),
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

        restore(savedInstance) {

            this.dispose();

            this.bezierPatches = new Grid(savedInstance.rows, savedInstance.cols);

            let controlPoints = savedInstance.controlPoints.map(p => {
                return new ControlPoint(this.ownerProjection, p.x, p.y, p.z);
            })

            for (let i = 0; i < controlPoints.length; i++) {
                let cpData = savedInstance.controlPoints[i];
                controlPoints[i].addChildren(...cpData.children.map(i => controlPoints[i]));
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

            console.log(savedInstance);
            console.log(this.bezierPatches);

        }

        compute(u, v, mode) {
            for (let p of this.bezierPatches) {
                if (p.domain.contains(u, v))
                    return p.compute(u, v, mode);
            };
            debugger;
        }


        update() {
            this.bezierPatches.forEach(p => p.update());
        }

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

    class BezierPatch3 {
        constructor(ownerProjection, domain, controlPoints) {
            this.ownerProjection = ownerProjection;
            this.controlPoints = controlPoints;
            this.domain = domain;
        }

        coons(u, v) {

            let f1 = (x) => 1 - 3 * x * x + 2 * x * x * x;
            let f2 = (x) => 3 * x * x - 2 * x * x * x;

            let f1v = f1(v), f1u = f1(u), f2v = f2(v), f2u = f2(u);

            let cp = this.controlPoints;

            let ruledU = new THREE.Vector3();
            let ruledV = new THREE.Vector3();
            let bilinearUV = new THREE.Vector3();

            let u0 = new BezierCurve3(cp[0], cp[4], cp[8], cp[12]);
            let u1 = new BezierCurve3(cp[3], cp[7], cp[11], cp[15]);
            let v0 = new BezierCurve3(cp[0], cp[1], cp[2], cp[3]);
            let v1 = new BezierCurve3(cp[12], cp[13], cp[14], cp[15]);

            //ruledU.copy(u0.compute(v)).lerp(u1.compute(v), u);
            //ruledV.copy(v0.compute(u)).lerp(v1.compute(u), v);

            ruledU.copy(u0.compute(v).multiplyScalar(f1u)).add(u1.compute(v).multiplyScalar(f2u));
            ruledV.copy(v0.compute(u).multiplyScalar(f1v)).add(v1.compute(u).multiplyScalar(f2v));

            let vec = buffers.vec3[0];

            bilinearUV
                .add(vec.copy(cp[0]).multiplyScalar(f1(v) * f1(u)))
                .add(vec.copy(cp[3]).multiplyScalar(f1(v) * f2(u)))
                .add(vec.copy(cp[12]).multiplyScalar(f2(v) * f1(u)))
                .add(vec.copy(cp[15]).multiplyScalar(f2(v) * f2(u)));

            return ruledV.add(ruledU).sub(bilinearUV);


        }

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

        update() {
            // Compute middle control points
            let cp = this.controlPoints;
            cp.forEach(p => p.update());

            /*
            cp[5].copy(cp[4]).add(cp[1]).sub(cp[0]);
            cp[6].copy(cp[2]).add(cp[7]).sub(cp[3]);
            cp[9].copy(cp[8]).add(cp[13]).sub(cp[12]);
            cp[10].copy(cp[14]).add(cp[11]).sub(cp[15]);
            */

            cp.forEach(c => c.update());
        }

        dispose() {
            this.controlPoints.forEach(p => p.dispose());
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
                zoom: 1,
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


            // create patches outline mesh
            {
                const vertexCount = 2 * 10000;

                let patchesOutlineGeom = new THREE.BufferGeometry();

                patchesOutlineGeom.addAttribute("position", new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));

                this.meshes.patchesOutline = new THREE.LineSegments(patchesOutlineGeom, new THREE.LineBasicMaterial({
                    color: this.options.handleColor,
                }));
                this.scene.add(this.meshes.patchesOutline);
            }

            // create patches interior lines 
            {
                const vertexCount = 2 * 10000;

                let patchesInteriorGeom = new THREE.BufferGeometry();

                patchesInteriorGeom.addAttribute("position", new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));

                this.meshes.patchesInterior = new THREE.LineSegments(patchesInteriorGeom, new THREE.LineBasicMaterial({
                    color: this.options.handleColor,
                    transparent: true,
                    opacity: 0.35
                }));
                this.scene.add(this.meshes.patchesInterior);
            }

            this.meshes.handleLines.visible = false;
            this.meshes.gridLines.visible = !this.options.preview;
            this.meshes.patchesInterior.visible = !this.options.preview;
            this.meshes.patchesOutline.visible = !this.options.preview;


            this.reshape();

        }

        /**
         * Called after the component is constructed.
         * @private
         */
        initialize(container, aspectRatio) {

            // Main container
            this.container = document.querySelector(container);

            // Init mouse info
            this.mouse = {
                pos: new THREE.Vector3(),
                ndc: new THREE.Vector3(),
                prev: {
                    pos: new THREE.Vector3(),
                    ndc: new THREE.Vector3()
                },
                leftButtonDown: false,
                rightButtonDown: false
            };

            // Key state info
            this.keystate = {};

            this.cameraOrigin = new THREE.Vector3();


            // Init three.js renderer
            this.renderer = new THREE.WebGLRenderer({ antialias: true });
            this.textures = new Textures;
            this.history = new History();

            this.raycaster = new THREE.Raycaster();

            // Create initial patch
            {

                let bl = buffers.vec3[0].set(-1 * aspectRatio * 0.7, -1 * 0.7, 0);
                let br = buffers.vec3[1].set(+1 * aspectRatio * 0.7, -1 * 0.7, 0);
                let tl = buffers.vec3[2].set(-1 * aspectRatio * 0.7, +1 * 0.7, 0);
                let tr = buffers.vec3[3].set(+1 * aspectRatio * 0.7, +1 * 0.7, 0);


                this.patch = new Patch(this);
                this.patch.initFromCorners(tl, tr, bl, br);

                window["patch"] = this.patch;
            }

            this.container.appendChild(this.renderer.domElement);
            this.container.addEventListener("mouseleave", this.mouseleave.bind(this));
            this.container.addEventListener("mousemove", this.mousemove.bind(this));
            this.container.addEventListener("mousedown", this.mousedown.bind(this));
            this.container.addEventListener("mouseup", this.mouseup.bind(this));
            this.container.addEventListener("contextmenu", (evt) => evt.preventDefault());

            window.addEventListener("resize", this.reshape.bind(this));
            window.addEventListener("keypress", this.keypress.bind(this));
            window.addEventListener("keydown", this.keydown.bind(this));
            window.addEventListener("keyup", this.keyup.bind(this));

            this.saveHistory();

        }

        restoreHistory() {
            let current = this.history.current();
            this.patch.restore(current.patchData);
        }

        saveHistory() {
            this.history.insert({ patchData: this.patch.save() });
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

            this.renderer.clearColor();

            this.renderer.render(this.scene, this.camera);
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
                let linesPositions = this.meshes.gridLines.geometry.attributes.position;
                let planePositions = this.meshes.plane.geometry.attributes.position;

                for (let x = 0; x < gs + 1; x++) {
                    for (let y = 0; y < gs + 1; y++) {
                        let idx = y * (gs + 1) + x;
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


            // Update handle lines 
            {

                let linesGeometry = this.meshes.handleLines.geometry;
                let linesPositions = linesGeometry.attributes.position;
                let count = 0;

                this.patch.bezierPatches.forEach(patch => {
                    for (let cp of patch.controlPoints) {
                        for (let child of cp.children) {

                            linesPositions.array[count * 3 + 0] = cp.x;
                            linesPositions.array[count * 3 + 1] = cp.y;
                            linesPositions.array[count * 3 + 2] = 0.02;

                            linesPositions.array[count * 3 + 3] = child.x;
                            linesPositions.array[count * 3 + 4] = child.y;
                            linesPositions.array[count * 3 + 5] = 0.02;

                            count += 2;
                        }
                    }
                });

                linesPositions.needsUpdate = true;

                linesGeometry.setDrawRange(0, count);

            }

            // Update patches outline
            {
                let patchesOutlintGeometry = this.meshes.patchesOutline.geometry;
                let patchesOutlinePosition = patchesOutlintGeometry.attributes.position;
                let count = 0;

                for (let patch of this.patch.bezierPatches) {
                    let cps = patch.controlPoints;
                    let vertices = [
                        cps[0], cps[1], cps[2], cps[3],
                        cps[7], cps[11], cps[15], cps[14],
                        cps[13], cps[12], cps[8], cps[4]
                    ]
                    for (let i = 0; i < vertices.length; i++) {

                        patchesOutlinePosition.array[count * 3 + 0] = vertices[i].x;
                        patchesOutlinePosition.array[count * 3 + 1] = vertices[i].y;
                        patchesOutlinePosition.array[count * 3 + 2] = 0.03;

                        patchesOutlinePosition.array[(count + 1) * 3 + 0] = vertices[(i + 1) % vertices.length].x;
                        patchesOutlinePosition.array[(count + 1) * 3 + 1] = vertices[(i + 1) % vertices.length].y;
                        patchesOutlinePosition.array[(count + 1) * 3 + 2] = 1;

                        count += 2;

                    }
                }

                patchesOutlinePosition.needsUpdate = true;
                patchesOutlintGeometry.setDrawRange(0, count)

            }

            // Update patches interior
            {
                let patchesInteriorGeometry = this.meshes.patchesInterior.geometry;
                let patchesInteriorPosition = patchesInteriorGeometry.attributes.position;
                let count = 0;
                for (let patch of this.patch.bezierPatches) {

                    let cps = patch.controlPoints;

                    for (let i = 0; i < 3; i++) {
                        for (let j = 1; j < 3; j++) {

                            // Horizontal
                            let u0 = cps[j * 4 + i];
                            let u1 = cps[j * 4 + i + 1];

                            patchesInteriorPosition.array[count * 3 + 0] = u0.x;
                            patchesInteriorPosition.array[count * 3 + 1] = u0.y;
                            patchesInteriorPosition.array[count * 3 + 2] = 0.03;

                            patchesInteriorPosition.array[count * 3 + 3] = u1.x;
                            patchesInteriorPosition.array[count * 3 + 4] = u1.y;
                            patchesInteriorPosition.array[count * 3 + 5] = 0.03;

                            // Vertical
                            let v0 = cps[i * 4 + j];
                            let v1 = cps[(i + 1) * 4 + j];

                            patchesInteriorPosition.array[count * 3 + 6] = v0.x;
                            patchesInteriorPosition.array[count * 3 + 7] = v0.y;
                            patchesInteriorPosition.array[count * 3 + 8] = 0.03;

                            patchesInteriorPosition.array[count * 3 + 9] = v1.x;
                            patchesInteriorPosition.array[count * 3 + 10] = v1.y;
                            patchesInteriorPosition.array[count * 3 + 11] = 0.03;


                            count += 4;

                        }
                    }

                }

                patchesInteriorPosition.needsUpdate = true;
                patchesInteriorGeometry.setDrawRange(0, count);
            }

        }
        /**
         * Updates the projection matrix
         * @private
         */
        updateProjectionMatrix() {
            let [w, h] = [this.container.clientWidth, this.container.clientHeight];
            let z = 1 / this.options.zoom;
            this.camera.left = -w / h * z + this.cameraOrigin.x;
            this.camera.right = w / h * z + this.cameraOrigin.x;
            this.camera.bottom = -z + this.cameraOrigin.y;
            this.camera.top = z + this.cameraOrigin.y;
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

        keydown(evt) {
            this.keystate[evt.code] = true;
        }

        keyup(evt) {
            delete this.keystate[evt.code];
        }

        keypress(evt) {
            if (evt.ctrlKey) {
                switch (evt.code) {
                    case "KeyZ": // Undo
                        this.history.back();
                        this.restoreHistory();
                        break;
                    case "KeyY": // Redo
                        this.history.forward();
                        this.restoreHistory();
                        break;
                }
            }

            if (evt.code === "KeyS") {

                let uv = this.intersectMesh(this.mouse.ndc);

                if (uv) {
                    this.patch.subdivideHorizontal(uv.y);
                    this.saveHistory();
                }

            }


            if (evt.code === "KeyA") {

                let uv = this.intersectMesh(this.mouse.ndc);

                if (uv) {
                    this.patch.subdivideVertical(uv.x);
                    this.saveHistory();
                }

            }

        }

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

        mouseleave(evt) {
            this.mouse.leftButtonDown = false;
            this.mouse.rightButtonDown = false;
        }

        mousedown(evt) {
            this.mouse.leftButtonDown = evt.button === 0;
            this.mouse.rightButtonDown = evt.button === 2;
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
                mx += t.offsetLeft
                my += t.offsetTop;
            }


            this.mouse.prev.ndc.copy(this.mouse.ndc);
            this.mouse.prev.pos.copy(this.mouse.pos);

            this.mouse.pos.set(mx, my, 0);
            this.mouse.ndc.set(
                mx / this.container.clientWidth * 2 - 1,
                - (my / this.container.clientHeight) * 2 + 1,
                0
            )

            
            if (this.selectedHandle) {
                this.selectedHandle.move(mx, my);
            }


        }

        /**
         * Mouse up event handler for window
         * @private
         * @param {MouseEvent} evt 
         */
        mouseup(evt) {

            this.mouse.leftButtonDown = false;
            this.mouse.rightButtonDown = false;

            if (this.selectedHandle) {

                if (this.dragHandleInfo.position.distanceTo(this.selectedHandle) > 0) {
                    this.saveHistory();
                }

                this.dragHandleInfo = null;
                this.selectedHandle = null;
            }
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

        setSelectedHandle(handle) {
            this.selectedHandle = handle;

            this.dragHandleInfo = {
                position: new THREE.Vector3().copy(handle),
                patchData: this.patch.save()
            }
        }

    }

    exportObj[exportName] = {
        BezierMeshProjection: BezierMeshProjection
    }

})(window, "bm");

