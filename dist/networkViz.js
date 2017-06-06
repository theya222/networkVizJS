"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const d3 = require("d3");
const cola = require("webcola");
let levelgraph = require('levelgraph');
let level = require('level-browserify');
const updateColaLayout_1 = require("./updateColaLayout");
const createColorArrow_1 = require("./util/createColorArrow");
function networkVizJS(documentId, userLayoutOptions) {
    /**
     * Default options for webcola and graph
     */
    let defaultLayoutOptions = {
        databaseName: `Userdb-${Math.random() * 100}`,
        layoutType: "flowLayout",
        jaccardModifier: 0.7,
        avoidOverlaps: true,
        handleDisconnected: false,
        flowDirection: "y",
        enableEdgeRouting: true,
        nodeShape: "rect",
        width: 900,
        height: 600,
        pad: 5,
        margin: 10,
        allowDrag: true,
        // This callback is called when a drag event starts on a node.
        canDrag: undefined,
        nodeDragStart: undefined,
        edgeLabelText: undefined,
        // Both mouseout and mouseover take data AND the selection (arg1, arg2)
        mouseDownNode: undefined,
        mouseOverNode: undefined,
        mouseOutNode: undefined,
        mouseUpNode: undefined,
        // These are "live options"
        nodeToColor: "white",
        nodeStrokeWidth: 2,
        nodeStrokeColor: "black",
        // TODO: clickNode (node, element) => void
        clickNode: (node) => console.log("clicked", node),
        clickAway: () => undefined,
        edgeColor: "black",
        edgeStroke: 2,
        edgeLength: d => { console.log(`length`, d); return 150; },
        clickEdge: (d, element) => undefined
    };
    let internalOptions = {
        isDragging: false
    };
    /**
     * Create the layoutOptions object with the users options
     * overriding the default options.
     */
    let layoutOptions = Object.assign({}, defaultLayoutOptions, userLayoutOptions);
    /**
     * Check that the user has provided a valid documentId
     * and check that the id exists.
     */
    if (typeof documentId !== "string" || documentId === "") {
        throw new Error("Document Id passed into graph isn't a valid string.");
    }
    if (document.getElementById(documentId) === undefined) {
        throw new Error(`Can't find id '#${documentId}' on the page.`);
    }
    /**
     * Declare variables that are needed.
     */
    let nodeMap = new Map();
    let predicateTypeToColorMap = new Map();
    /**
     * Todo:    This is currently a hack. Create a random database on the client
     *          side to build the networks on top of.
     */
    if (!layoutOptions.databaseName || typeof layoutOptions.databaseName !== "string") {
        console.error("Make sure databaseName property exists and is a string.");
        console.error("Choosing a default name for the database.");
        layoutOptions.databaseName = defaultLayoutOptions.databaseName;
    }
    let tripletsDB = levelgraph(level(layoutOptions.databaseName));
    /**
     * These represent the data that d3 will visualize.
     */
    let nodes = [];
    let links = [];
    let groups = [];
    let groupByHashes = [];
    const width = layoutOptions.width, height = layoutOptions.height, margin = layoutOptions.margin, pad = layoutOptions.pad;
    /**
     * Create svg canvas that is responsive to the page.
     * This will try to fill the div that it's placed in.
     */
    let svg = d3.select(`#${documentId}`)
        .append("div")
        .classed("svg-container", true)
        .append("svg")
        .attr("preserveAspectRatio", "xMinYMin meet")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .classed("svg-content-responsive", true);
    svg.on("click", layoutOptions.clickAway);
    /**
     * Set up [webcola](http://marvl.infotech.monash.edu/webcola/).
     * The helper function updateColaLayout allows for restarting
     * the simulation whenever the layout is changed.
     */
    let simulation = updateColaLayout_1.updateColaLayout(layoutOptions)
        .nodes(nodes)
        .links(links)
        .groups(groups)
        .start();
    /**
     * Call nodeDragStart callback when drag event triggers.
     */
    let drag = simulation.drag();
    drag.filter(() => (layoutOptions.canDrag === undefined) || (layoutOptions.canDrag && layoutOptions.canDrag()));
    drag.on("start", () => {
        layoutOptions.nodeDragStart && layoutOptions.nodeDragStart();
        internalOptions.isDragging = true;
    }).on("end", () => {
        internalOptions.isDragging = false;
    });
    /**
     * Create the defs element that stores the arrow heads.
     */
    const defs = svg.append("defs");
    // Define svg groups for storing the visuals.
    let g = svg.append('g'), group = g.append('g')
        .selectAll('.group'), link = g.append('g')
        .selectAll('.link'), node = g.append('g')
        .selectAll('.node');
    /**
     * Zooming and panning behaviour.
     */
    let zoom = d3.zoom().scaleExtent([0.1, 5]).on("zoom", zoomed);
    zoom.filter(function () {
        // Prevent zoom when mouse over node.
        return d3.event.target.tagName.toLowerCase() === "svg";
    });
    svg.call(zoom);
    function zoomed() {
        layoutOptions.clickAway();
        g.attr("transform", d3.event.transform);
    }
    /**
     * Resets width or radius of nodes.
     * Allows dynamically changing node sizes based on text.
     */
    function updatePathDimensions() {
        node.select('path')
            .attr('transform', function (d) {
            // Scale appropriately using http://stackoverflow.com/a/9877871/6421793
            let currentWidth = this.getBBox().width, w = d.width, currentHeight = this.getBBox().height, h = d.height, scaleW = w / currentWidth, scaleH = h / currentHeight;
            return `translate(${-w / 2},${-h / 2}) scale(${scaleW},${scaleH})`;
        });
    }
    /**
     * Update the d3 visuals without layout changes.
     */
    function updateStyles() {
        ///// GROUPS /////
        group = group.data(groups);
        let groupEnter = group.enter()
            .append('rect')
            .attr('rx', 8)
            .attr('ry', 8)
            .attr('class', 'group')
            .style('fill', 'green');
        // .call(simulation.drag);
        group = group.merge(groupEnter);
        /////// NODE ///////
        node = node.data(nodes, d => d.index);
        node.exit().remove();
        let nodeEnter = node.enter()
            .append("g")
            .classed("node", true);
        // Only allow dragging nodes if turned on.
        if (layoutOptions.allowDrag) {
            nodeEnter.attr("cursor", "move").call(drag);
        }
        else {
            nodeEnter.attr("cursor", "default");
        }
        // Here we add node beauty.
        // To fit nodes to the short-name calculate BBox
        // from https://bl.ocks.org/mbostock/1160929
        nodeEnter.append("text")
            .attr("dx", 0)
            .attr("dy", 0)
            .attr("text-anchor", "middle")
            .style("font", "100 22px Helvetica Neue");
        // Choose the node shape and style.
        let nodeShape;
        nodeShape = nodeEnter.insert("path", "text");
        if (typeof layoutOptions.nodeShape == "string" && layoutOptions.nodeShape == "rect") {
            // nodeShape = nodeEnter.insert("rect", "text")     // The second arg is what the rect will sit behind.
            nodeShape.attr('d', 'M16 48 L48 48 L48 16 L16 16 Z');
        }
        else if (typeof layoutOptions.nodeShape == "string" && layoutOptions.nodeShape == "circle") {
            // Circle path technique from:
            // http://stackoverflow.com/a/10477334/6421793
            nodeShape.attr('d', 'M20,40a20,20 0 1,0 40,0a20,20 0 1,0 -40,0');
        }
        else if (typeof layoutOptions.nodeShape == "function") {
            nodeShape.attr('d', layoutOptions.nodeShape);
        }
        nodeShape.classed("node", true)
            .attr('vector-effect', 'non-scaling-stroke');
        // Merge the entered nodes to the update nodes.        
        node = node.merge(nodeEnter);
        /**
         * Update the text property (allowing dynamically changing text)
         * Check if the d.shortname is a list.
         */
        let textSelect = node.select("text")
            .text(undefined)
            .each(function (d) {
            // This function takes the text element.
            // We can call .each on it and build up
            // the tspan elements from the array of text
            // in the data.
            // Derived from https://bl.ocks.org/mbostock/7555321
            let margin = layoutOptions.margin, pad = layoutOptions.pad;
            const extra = 2 * margin + 2 * pad;
            let text = d3.select(this);
            /**
             * If no shortname, then use hash.
             */
            let tempText = d.shortname || d.hash;
            if (!Array.isArray(tempText)) {
                tempText = [tempText];
            }
            let textCopy = tempText.slice(), 
            // text = d3.select(this),
            words = textCopy.reverse(), lineheight = 1.1, // em
            lineNumber = 0, dy = parseFloat(text.attr("dy")) || 0, word, 
            // TODO: I don't know why there needs to be a null tspan at the start?
            tspan = text.text(null).append("tspan").attr("dy", dy + "em");
            while (word = words.pop()) {
                tspan = text.append("tspan").attr("dy", lineheight + "em").text(word);
            }
            // Loop over the tspans and recalculate the width based on the longest text.
            text.selectAll('tspan').each(function (d) {
                if (!(d.width)) {
                    d.width = 0;
                }
                let lineLength = this.getComputedTextLength();
                if (d.width < lineLength + extra) {
                    d.width = lineLength + extra;
                }
            });
        })
            .each(function (d) {
            // Only update the height, the width is calculated
            // by iterating over the tspans in the `wrap` function.
            const b = this.getBBox();
            const extra = 2 * margin + 2 * pad;
            d.height = b.height + extra;
        })
            .attr("y", function (d) {
            const b = d3.select(this).node().getBBox();
            // Todo: Minus 2 is a hack to get the text feeling 'right'.
            return d.height / 2 - b.height / 2 - 2;
        })
            .attr("x", function (d) {
            // Apply the correct x value to the tspan.
            const b = this.getBBox();
            const x = d.width / 2 - b.width / 2;
            // We don't set the tspans with an x attribute.
            d3.select(this).selectAll('tspan')
                .attr('x', d.width / 2);
            return x;
        })
            .attr("pointer-events", "none");
        /**
         * Here we can update node properties that have already been attached.
         * When restart() is called, these are the properties that will be affected
         * by mutation.
         */
        let updateShapes = node.select('path');
        // These changes apply to both rect and circle
        updateShapes
            .attr("fill", layoutOptions.nodeToColor)
            .attr("stroke", layoutOptions.nodeStrokeColor)
            .attr("stroke-width", layoutOptions.nodeStrokeWidth);
        // update size
        updatePathDimensions();
        // These CANNOT be arrow functions or 'this' context becomes wrong.
        updateShapes.on('mouseover', function (d) {
            if (internalOptions.isDragging) {
                return;
            }
            let element = d3.select(this);
            layoutOptions.mouseOverNode && layoutOptions.mouseOverNode(d, element);
        }).on('mouseout', function (d) {
            if (internalOptions.isDragging) {
                return;
            }
            let element = d3.select(this);
            layoutOptions.mouseOutNode && layoutOptions.mouseOutNode(d, element);
        }).on('click', function (d) {
            let elem = d3.select(this);
            setTimeout(() => {
                layoutOptions.clickNode(d, elem);
            }, 50);
        }).on("mouseup", function (d) {
            layoutOptions.mouseUpNode && layoutOptions.mouseUpNode(d, d3.select(this));
        }).on("mousedown", function (d) {
            if ((layoutOptions.canDrag === undefined) || (layoutOptions.canDrag && layoutOptions.canDrag())) {
                return;
            }
            ;
            layoutOptions.mouseDownNode && layoutOptions.mouseDownNode(d, d3.select(this));
        });
        /////// LINK ///////
        link = link.data(links, d => d.source.index + "-" + d.target.index);
        link.exit().remove();
        let linkEnter = link.enter()
            .append("g")
            .classed("line", true);
        linkEnter.append("path")
            .attr("stroke-width", layoutOptions.edgeStroke)
            .attr("stroke", layoutOptions.edgeColor)
            .attr("fill", "none")
            .attr("marker-end", d => `url(#arrow-${typeof layoutOptions.edgeColor == "string" ? layoutOptions.edgeColor : layoutOptions.edgeColor(d.edgeData)})`);
        linkEnter.on('click', function (d) {
            let elem = d3.select(this);
            setTimeout(() => {
                layoutOptions.clickEdge(d, elem);
            }, 50);
        });
        /** Optional label text */
        if (layoutOptions.edgeLabelText !== "undefined") {
            linkEnter.append("text")
                .attr("text-anchor", "middle")
                .style("font", "100 22px Helvetica Neue")
                .text(layoutOptions.edgeLabelText);
        }
        link = link.merge(linkEnter);
    }
    /**
     * restart function adds and removes nodes.
     * It also restarts the simulation.
     * This is where aesthetics can be changed.
     */
    function restart() {
        updateStyles();
        /**
         * Helper function for drawing the lines.
         */
        const lineFunction = d3.line()
            .x(d => d.x)
            .y(d => d.y);
        /**
         * Causes the links to bend around the rectangles.
         * Source: https://github.com/tgdwyer/WebCola/blob/master/WebCola/examples/unix.html#L140
         */
        const routeEdges = function () {
            if (links.length == 0 || !layoutOptions.enableEdgeRouting) {
                return;
            }
            simulation.prepareEdgeRouting();
            link.select('path').attr("d", d => lineFunction(simulation.routeEdge(d, undefined)));
            if (isIE())
                link.select('path').each(function (d) { this.parentNode.insertBefore(this, this); });
            link.select('text').attr("x", d => {
                let arrayX = simulation.routeEdge(d, undefined);
                let middleIndex = Math.floor(arrayX.length / 2) - 1;
                return (arrayX[middleIndex].x + arrayX[middleIndex + 1].x) / 2;
            }).attr("y", d => {
                let arrayY = simulation.routeEdge(d, undefined);
                let middleIndex = Math.floor(arrayY.length / 2) - 1;
                return (arrayY[middleIndex].y + arrayY[middleIndex + 1].y) / 2;
            });
        };
        // Restart the simulation.
        simulation.links(links) // Required because we create new link lists
            .groups(groups)
            .start(10, 15, 20).on("tick", function () {
            node.each(d => {
                if (d.bounds) {
                    // Initiate the innerBounds, and create it based on the width and height
                    // of the node.
                    d.innerBounds = d.bounds.inflate(0);
                    d.innerBounds.X = d.innerBounds.x + d.width;
                    d.innerBounds.Y = d.innerBounds.y + d.height;
                }
            });
            node.attr("transform", d => d.innerBounds ?
                `translate(${d.innerBounds.x},${d.innerBounds.y})`
                : `translate(${d.x},${d.y})`);
            updatePathDimensions();
            link.select('path').attr("d", d => {
                let route = cola.makeEdgeBetween(d.source.innerBounds, d.target.innerBounds, 5);
                return lineFunction([route.sourceIntersection, route.arrowStart]);
            });
            if (isIE())
                link.each(function (d) { this.parentNode.insertBefore(this, this); });
            link.select('text')
                .attr('x', d => {
                let route = cola.makeEdgeBetween(d.source.innerBounds, d.target.innerBounds, 5);
                return (route.sourceIntersection.x + route.targetIntersection.x) / 2;
            })
                .attr('y', d => {
                let route = cola.makeEdgeBetween(d.source.innerBounds, d.target.innerBounds, 5);
                return (route.sourceIntersection.y + route.targetIntersection.y) / 2;
            });
            group.attr('x', function (d) { return d.bounds.x; })
                .attr('y', function (d) { return d.bounds.y; })
                .attr('width', function (d) { return d.bounds.width(); })
                .attr('height', function (d) { return d.bounds.height(); });
        }).on("end", routeEdges);
        function isIE() { return ((navigator.appName == 'Microsoft Internet Explorer') || ((navigator.appName == 'Netscape') && (new RegExp("Trident/.*rv:([0-9]{1,}[\.0-9]{0,})").exec(navigator.userAgent) != undefined))); }
        // After a tick make sure to add translation to the nodes.
        // Sometimes it wasn't added in a single tick.
        node.attr("transform", d => d.innerBounds ?
            `translate(${d.innerBounds.x},${d.innerBounds.y})`
            : `translate(${d.x},${d.y})`);
    }
    // Helper function for updating links after node mutations.
    // Calls a function after links added.
    function createNewLinks() {
        tripletsDB.get({}, (err, l) => {
            if (err) {
                console.error(err);
            }
            // Create edges based on LevelGraph triplets
            links = l.map(({ subject, object, edgeData }) => {
                let source = nodeMap.get(subject);
                let target = nodeMap.get(object);
                return { source, target, edgeData };
            });
            restart();
        });
    }
    /**
     * Take a node object or list of nodes and add them.
     * @param {object | object[]} nodeObject
     */
    function addNode(nodeObjectOrArray) {
        /** Define helper functions at the top */
        /**
         * Checks if object is an array:
         * http://stackoverflow.com/a/34116242/6421793
         * @param {object|array} obj
         */
        function isArray(obj) {
            return !!obj && obj.constructor === Array;
        }
        function addNodeObjectHelper(nodeObject) {
            // Check that hash exists
            if (!(nodeObject.hash)) {
                var e = new Error("Node requires a hash field.");
                console.error(e);
                return;
            }
            // TODO: remove this hack
            if (!(nodeObject.x)) {
                nodeObject.x = layoutOptions.width / 2;
            }
            if (!(nodeObject.y)) {
                nodeObject.y = layoutOptions.height / 2;
            }
            // Add node to graph
            if (!nodeMap.has(nodeObject.hash)) {
                simulation.stop();
                // Set the node
                nodes.push(nodeObject);
                nodeMap.set(nodeObject.hash, nodeObject);
            }
        }
        /**
         * Check that the input is valid
         */
        if (typeof nodeObjectOrArray !== "object") {
            var e = new Error("Parameter must be either an object or an array");
            console.error(e);
            return;
        }
        if (isArray(nodeObjectOrArray)) {
            // Run through the array adding the nodes
            nodeObjectOrArray.forEach(addNodeObjectHelper);
        }
        else {
            addNodeObjectHelper(nodeObjectOrArray);
        }
        // Draw the changes.
        restart();
    }
    /**
     * Validates triplets.
     * @param {object} tripletObject
     */
    function tripletValidation(tripletObject) {
        /**
         * Check that minimum requirements are met.
         */
        if (tripletObject === undefined) {
            var e = new Error("TripletObject undefined");
            console.error(e);
            return false;
        }
        // Node needs a unique hash associated with it.
        let subject = tripletObject.subject, predicate = tripletObject.predicate, object = tripletObject.object;
        if (!(subject && predicate && object && true)) {
            console.error(new Error("Triplets added need to include all three fields."));
        }
        // Check that hash exists
        if (!(subject.hash && object.hash)) {
            let e = new Error("Subject and Object require a hash field.");
            console.error(e);
            return false;
        }
        // Check that type field exists on predicate
        if (!predicate.type) {
            let e = new Error("Predicate requires type field.");
            console.error(e);
            return false;
        }
        // Check that type field is a string on predicate
        if (typeof predicate.type !== "string") {
            let e = new Error("Predicate type field must be a string");
            console.error(e);
            return false;
        }
        return true;
    }
    /**
     * Adds a triplet object. Adds the node if it's not already added.
     * Otherwise it just adds the edge
     * @param {object} tripletObject
     */
    function addTriplet(tripletObject) {
        if (!tripletValidation(tripletObject)) {
            return;
        }
        // Node needs a unique hash associated with it.
        let subject = tripletObject.subject, predicate = tripletObject.predicate, object = tripletObject.object;
        // Check that predicate doesn't already exist
        new Promise((resolve, reject) => tripletsDB.get({ subject: subject.hash,
            predicate: predicate.type,
            object: object.hash }, function (err, list) {
            if (err)
                reject(err);
            resolve(list.length === 0);
        })).then(doesntExist => {
            if (!doesntExist) {
                return new Error("That edge already exists. Hash's and predicate type needs to be unique!");
            }
            /**
             * If a predicate type already has a color,
             * it is not redefined.
             */
            let edgeColor = typeof layoutOptions.edgeColor == "string" ? layoutOptions.edgeColor : layoutOptions.edgeColor(predicate);
            if (!predicateTypeToColorMap.has(edgeColor)) {
                predicateTypeToColorMap.set(edgeColor, true);
                // Create an arrow head for the new color
                createColorArrow_1.default(defs, edgeColor);
            }
            /**
             * Put the triplet into the LevelGraph database
             * and mutates the d3 nodes and links list to
             * visually pop on the node/s.
             */
            tripletsDB.put({
                subject: subject.hash,
                predicate: predicate.type,
                object: object.hash,
                edgeData: predicate
            }, (err) => {
                if (err) {
                    console.error(err);
                }
                // Add nodes to graph
                simulation.stop();
                if (!nodeMap.has(subject.hash)) {
                    // Set the node
                    nodes.push(subject);
                    nodeMap.set(subject.hash, subject);
                }
                if (!nodeMap.has(object.hash)) {
                    nodes.push(object);
                    nodeMap.set(object.hash, object);
                }
                createNewLinks();
            });
        });
    }
    function addEdge(triplet) {
        if (!tripletValidation(triplet)) {
            return;
        }
        // Node needs a unique hash associated with it.
        let subject = triplet.subject, predicate = triplet.predicate, object = triplet.object;
        if (!(nodeMap.has(subject.hash) && nodeMap.has(object.hash))) {
            // console.error("Cannot add edge between nodes that don't exist.")
            return;
        }
        /**
         * Put the triplet into the LevelGraph database
         * and mutates the d3 nodes and links list to
         * visually pop on the node/s.
         */
        tripletsDB.put({
            subject: subject.hash,
            predicate: predicate.type,
            object: object.hash,
            edgeData: predicate
        }, (err) => {
            if (err) {
                console.error(err);
            }
            createNewLinks();
        });
    }
    /**
     * Removes the node and all triplets associated with it.
     * @param {String} nodeHash hash of the node to remove.
     */
    function removeNode(nodeHash, callback) {
        tripletsDB.get({ subject: nodeHash }, function (err, l1) {
            if (err) {
                return console.error(err);
            }
            tripletsDB.get({ object: nodeHash }, function (err, l2) {
                if (err) {
                    return console.error(err);
                }
                // Check if the node exists
                if (l1.length + l2.length === 0) {
                    // Once the edges are deleted we can remove the node.
                    let nodeIndex = -1;
                    for (let i = 0; i < nodes.length; i++) {
                        if (nodes[i].hash === nodeHash) {
                            nodeIndex = i;
                            break;
                        }
                    }
                    if (nodeIndex === -1) {
                        return console.error("There is no node");
                    }
                    simulation.stop();
                    nodes.splice(nodeIndex, 1);
                    nodeMap.delete(nodeHash);
                    createNewLinks();
                    // Do something after the removal of the node.
                    typeof callback === "function" && callback();
                    return;
                }
                tripletsDB.del([...l1, ...l2], function (err) {
                    if (err) {
                        return err;
                    }
                    ;
                    // Once the edges are deleted we can remove the node.
                    let nodeIndex = -1;
                    for (let i = 0; i < nodes.length; i++) {
                        if (nodes[i].hash === nodeHash) {
                            nodeIndex = i;
                            break;
                        }
                    }
                    if (nodeIndex === -1) {
                        return console.error("There is no node");
                    }
                    simulation.stop();
                    nodes.splice(nodeIndex, 1);
                    nodeMap.delete(nodeHash);
                    createNewLinks();
                    // do something after removing the node.
                    typeof callback === "function" && callback();
                });
            });
        });
    }
    /**
     * Function that fires when a node is clicked.
     * @param {function} selectNodeFunc
     */
    function setSelectNode(selectNodeFunc) {
        layoutOptions.clickNode = selectNodeFunc;
    }
    /**
     * Invoking this function will recenter the graph.
     */
    // function recenterGraph(){
    //     svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(1))
    // }
    /**
     * Function to call when mouse over registers on a node.
     * It takes a d3 mouse over event.
     * @param {function} mouseOverCallback
     */
    function setMouseOver(mouseOverCallback) {
        layoutOptions.mouseOverNode = mouseOverCallback;
    }
    /**
     * Function to call when mouse out registers on a node.
     * It takes a d3 mouse over event.
     * @param {function} mouseOutCallback
     */
    function setMouseOut(mouseOutCallback) {
        layoutOptions.mouseOutNode = mouseOutCallback;
    }
    // Function called when mousedown on node.
    function setMouseDown(mouseDownCallback) {
        layoutOptions.mouseDownNode = mouseDownCallback;
    }
    /**
     * Merges a node into another group.
     * If this node was in another group previously it removes it from the prior group.
     */
    function mergeNodeToGroup(nodeInGroupHash, nodeToMergeHash) {
        /**
         * Groups need to be defined using indexes.
         */
        let indexOfGroupNode = -1;
        let indexOfNodeToMerge = -1;
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].hash == nodeInGroupHash) {
                indexOfGroupNode = i;
            }
            if (nodes[i].hash == nodeToMergeHash) {
                indexOfNodeToMerge = i;
            }
            if (indexOfGroupNode !== -1 && indexOfNodeToMerge !== -1) {
                break;
            }
        }
        // Verify that the initial node exists.
        if (indexOfGroupNode == -1) {
            return console.error("You're trying to merge with a node that doesn't exist. Check that the node hash is correct.");
        }
        if (indexOfNodeToMerge == -1) {
            return console.error("The node you are trying to merge doesn't exist. Check the node hash is correct or add the node to the graph.");
        }
        // Find the set that the merge node is part of.
        // Also remove the node we're merging from any sets it might be in.
        let indexInSets = -1;
        groupByHashes.forEach((set, index) => {
            if (set.has(nodeInGroupHash)) {
                indexInSets = index;
                set.add(nodeToMergeHash);
            }
            if (set.has(nodeToMergeHash) && !set.has(nodeInGroupHash)) {
                set.delete(nodeToMergeHash);
            }
        });
        if (indexInSets === -1) {
            // Create a new grouping.
            groupByHashes.push(new Set([nodeToMergeHash, nodeInGroupHash]));
        }
        simulation.stop();
        // Here we create a new group object with the updated group unions.
        let newGroupObject = [];
        groupByHashes.forEach(set => {
            let indexOfSet = [];
            let setArray = [...set];
            let nodeIndex;
            for (let i = 0; i < setArray.length; i++) {
                nodeIndex = nodeMap.get(setArray[i]).index;
                indexOfSet.push(nodeIndex);
            }
            // Create and push an object with the indexes of the nodes.
            newGroupObject.push({ leaves: indexOfSet });
        });
        groups = newGroupObject;
        restart();
    }
    /**
     * Serialize the graph.
     * scheme: triplets: subj:hash-predicateType-obj:hash[]
     *         nodes: hash[]
     */
    const saveGraph = (callback) => {
        tripletsDB.get({}, function (err, list) {
            const saved = JSON.stringify({
                triplets: list.map(v => ({ subject: v.subject.hash, predicate: v.predicate.type, object: v.object.hash })),
                nodes: nodes.map(v => ({ hash: v.hash, x: v.x, y: v.y }))
            });
            callback(saved);
        });
    };
    // Public api
    /**
     * TODO:
     * Actually check which of these are absolutely garbage.
     * Allow reference to the graph in the options object.
     * Solutions?:
     *  - Maybe have a "this" reference passed into the callbacks.
     */
    return {
        hasNode: (nodeHash) => nodes.filter(v => v.hash == nodeHash).length === 1,
        saveGraph,
        getSVGElement: () => svg,
        addTriplet,
        addEdge,
        mergeNodeToGroup,
        removeNode,
        addNode,
        restart: {
            styles: updateStyles,
            layout: restart,
        },
        nodeOptions: {
            setClickNode: setSelectNode,
            setMouseOver,
            setMouseOut
        },
        edgeOptions: {
            setClickEdge: (callback) => { layoutOptions.clickEdge = callback; }
        },
        colaOptions: {
            flowLayout: {
                down: () => {
                    layoutOptions.flowDirection = 'y';
                    if (layoutOptions.layoutType == "flowLayout") {
                        simulation.flowLayout(layoutOptions.flowDirection, layoutOptions.edgeLength);
                    }
                    else {
                        layoutOptions.layoutType = "flowLayout";
                        simulation = updateColaLayout_1.updateColaLayout(layoutOptions);
                    }
                    restart();
                },
                right: () => {
                    layoutOptions.flowDirection = 'x';
                    if (layoutOptions.layoutType == "flowLayout") {
                        simulation.flowLayout(layoutOptions.flowDirection, layoutOptions.edgeLength);
                    }
                    else {
                        layoutOptions.layoutType = "flowLayout";
                        simulation = updateColaLayout_1.updateColaLayout(layoutOptions);
                    }
                    restart();
                }
            }
        }
    };
}
exports.default = networkVizJS;
//# sourceMappingURL=networkViz.js.map