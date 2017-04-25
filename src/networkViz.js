import * as cola from 'webcola';
import * as d3 from 'd3';
let levelgraph = require('levelgraph');
let level = require('level-browserify');

module.exports = function networkVizJS(documentId, userLayoutOptions = {}){

    /**
     * Default options for webcola and graph
     */
    let defaultLayoutOptions = {
        layoutType: "flowLayout", // Define webcola length layout algorithm
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
        nodeDragStart: undefined,
        edgeLabelText: undefined,
        // Both mouseout and mouseover take data AND the selection (arg1, arg2)
        mouseOverNode: undefined,
        mouseOutNode: undefined,
        // These are "live options"
        nodeToColor: undefined,
        nodeStrokeWidth: 2,
        nodeStrokeColor: "black",
        // TODO: clickNode (node, element) => void
        clickNode: (node) => console.log("clicked", node),
        clickAway: () => console.log("clicked away from stuff"),
        edgeColor: () => "black",
        edgeStroke: undefined,
        edgeLength: d => {console.log(`length`, d); return 150}
    }

    let internalOptions = {
        isDragging: false
    }

    /**
     * This creates the default object, and then overwrites any parameters
     * with the user parameters.
     */
    let layoutOptions = {
        ...defaultLayoutOptions,
        ...userLayoutOptions
    };


    if (typeof documentId !== "string" || documentId === "") {
        throw new Error("Document Id passed into graph isn't a string.");
    }

    /**
     * nodeMap allows hash lookup of nodes.
     */
    let nodeMap = new Map();
    let predicateTypeToColorMap = new Map();
    let tripletsDB = levelgraph(level(`Userdb-${Math.random()*100}`));
    let nodes = [];
    let links = [];

    const width = layoutOptions.width,
          height = layoutOptions.height,
          margin = layoutOptions.margin,
          pad = layoutOptions.pad;
    
    // Here we are creating a responsive svg element.
    let svg = d3.select(`#${documentId}`)
                .append("div")
                .classed("svg-container", true)
                .append("svg")
                .attr("preserveAspectRatio", "xMinYMin meet")
                .attr("viewBox", `0 0 ${width} ${height}`)
                .classed("svg-content-responsive", true);
    
    svg.on("click", () => {
        layoutOptions.clickAway();
    })

    /**
     * Set up [webcola](http://marvl.infotech.monash.edu/webcola/).
     * Later we'll be restarting the simulation whenever we mutate
     * the node or link lists.
     */
    let simulation = updateColaLayout();
    
    // Setting up the modified drag.
    // Calling webcola drag without arguments returns the drag event.
    let modifiedDrag = simulation.drag();
    modifiedDrag.on("start", () => {
        layoutOptions.nodeDragStart && layoutOptions.nodeDragStart()
        internalOptions.isDragging = true;
    }).on("end", ()=>{
        internalOptions.isDragging = false;
    });

    /**
     * Here we define the arrow heads to be used later.
     * Each unique arrow head needs to be created.
     */
    const defs = svg.append("defs");

    /**
     * Appends a new marker to the dom, for the new
     * marker color.
     * @param {defs DOMElement} definitionElement 
     * @param {string} color valid css color string
     */
    const createColorMarker = (definitionElement, color) => {
        definitionElement.append("marker")
            .attr("id",`arrow-${color}`)
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 8)
            .attr("markerWidth", 6)
            .attr("markerHeight", 6)
            .attr("fill", color)
            .attr("orient", "auto")
            .append("path")
                .attr("d", "M0,-5L10,0L0,5")
                .attr("class","arrowHead");
    }

    // Define svg groups
    let g = svg.append("g"),
        link = g.append("g")
                .selectAll(".link"),
        node = g.append("g")
                .selectAll(".node");
    
    /**
     * Add zoom/panning behaviour to svg.
     */
    let zoom = d3.zoom().scaleExtent([0.1, 5]).on("zoom", zoomed);
    svg.call(zoom);
    function zoomed() {
        layoutOptions.clickAway();
        g.attr("transform", d3.event.transform);
    }

    /**
     * Resets width or radius of nodes.
     * Used to support dynamically changing the node size
     * if the text is changing.
     */
    function updateRectCircleSize(){
        /**
         * Update the width and height here because otherwise the height and width
         * calculations don't occur.
         */
        node.select('rect')
            .attr("width", d => d.innerBounds && d.innerBounds.width() || d.width)
            .attr("height", d => d.innerBounds && d.innerBounds.height() || d.height);
        node.select('circle')
            .attr("r", d => (d.innerBounds && d.innerBounds.width() || d.width) / 2)
            .attr("cx", d => (d.innerBounds && d.innerBounds.width() || d.width) / 2)
            .attr("cy", d => (d.innerBounds && d.innerBounds.height() || d.height) / 2)
    }
    
    /**
     * This updates the d3 visuals without restarting the layout.
     */
    function updateStyles(){
        /////// NODE ///////

        node = node.data(nodes, d => d.index);
        node.exit().remove();
        let nodeEnter = node.enter()
                   .append("g")
                   .classed("node", true);
                   
        // Only allow dragging nodes if turned on.
        if (layoutOptions.allowDrag){
            nodeEnter.attr("cursor", "move").call(modifiedDrag);  
        } else {
            nodeEnter.attr("cursor", "default");
        }
                   
        
        // Here we add node beauty.
        // To fit nodes to the short-name calculate BBox
        // from https://bl.ocks.org/mbostock/1160929
        nodeEnter.append("text")
                    .attr("dx", -10)
                    .attr("dy", -2)
                    .attr("text-anchor", "middle")
                    .style("font", "100 22px Helvetica Neue");

                    
        // Choose the node shape and style.
        let nodeShape;
        if (layoutOptions.nodeShape == "rect"){
            nodeShape = nodeEnter.insert("rect", "text")     // The second arg is what the rect will sit behind.
        } else if (layoutOptions.nodeShape == "circle"){
            nodeShape = nodeEnter.insert("circle", "text")     // The second arg is what the rect will sit behind.
        }
        nodeShape.classed("node", true)
        
        // Merge the entered nodes to the update nodes.        
        node = node.merge(nodeEnter);

        /**
         * Update the text property (allowing dynamically changing text)
         */
        node.select("text")
                    .text(d => d.shortname || d.hash)
                    .each(function(d){
                        const b = this.getBBox();
                        const extra = 2 * margin + 2 * pad;
                        d.width = b.width + extra;
                        d.height = b.height + extra;
                    })
                    .attr("x", d => d.width / 2)
                    .attr("y", d => d.height / 2)
                    .attr("pointer-events", "none");

        /**
         * Here we can update node properties that have already been attached.
         * When restart() is called, these are the properties that will be affected
         * by mutation.
         */  
        let updateShapes = node.select('rect').merge(node.select('circle'))
        // These changes apply to both rect and circle
        updateShapes
                .attr("fill", d => layoutOptions.nodeToColor && layoutOptions.nodeToColor(d) || "aqua")
                .attr("stroke", layoutOptions.nodeStrokeColor)
                .attr("stroke-width", layoutOptions.nodeStrokeWidth);

        // update size
        updateRectCircleSize();


        // These CANNOT be arrow functions or this context is wrong.
        updateShapes.on('mouseover', function(d){
            if (internalOptions.isDragging){ return }

            let element = d3.select(this);
            layoutOptions.mouseOverNode(d, element);
        }).on('mouseout', function(d) {
            if (internalOptions.isDragging){ return }

            let element = d3.select(this);
            layoutOptions.mouseOutNode(d, element);
        }).on('click', function(d) {

            // coordinates is a tuple: [x,y]
            let elem = d3.select(this);
            setTimeout(() => {
                layoutOptions.clickNode(d, elem)
            }, 50)
            
        })

        /////// LINK ///////
        link = link.data(links, d => d.source.index + "-" + d.target.index);
        link.exit().remove();

        let linkEnter = link.enter()
                .append("g")
                .classed("line", true);

        
        linkEnter.append("path")
                   .attr("stroke-width", d => layoutOptions.edgeStroke && layoutOptions.edgeStroke(d) || 2)
                   .attr("stroke", d => layoutOptions.edgeColor(d.edgeData))
                   .attr("fill", "none")
                   .attr("marker-end",d => `url(#arrow-${layoutOptions.edgeColor(d.edgeData)})`);
        
        /** Optional label text */
        if (layoutOptions.edgeLabelText !== "undefined"){
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
    function restart(){
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
                return
            }

            simulation.prepareEdgeRouting();
            link.select('path').attr("d", d => lineFunction(simulation.routeEdge(d)));
            if (isIE()) link.select('path').each(function (d) { this.parentNode.insertBefore(this, this) });

            link.select('text').attr("x", d => {
                let arrayX = simulation.routeEdge(d);
                let middleIndex = Math.floor(arrayX.length /2) - 1;
                return (arrayX[middleIndex].x + arrayX[middleIndex + 1].x)/2
            }).attr("y", d => {
                let arrayY = simulation.routeEdge(d);
                let middleIndex = Math.floor(arrayY.length /2) - 1 ;
                return (arrayY[middleIndex].y + arrayY[middleIndex + 1].y)/2
            });
        }
        // Restart the simulation.
        simulation.links(links);    // Required because we create new link lists
        simulation.start(10, 15, 20).on("tick", function() {
            node.each(d => {
                    if (d.bounds) {
                        d.innerBounds = d.bounds.inflate(-margin);
                    }
                });
            node.attr("transform", d => d.innerBounds ?
                    `translate(${d.innerBounds.x},${d.innerBounds.y})`
                    :`translate(${d.x},${d.y})`);
            
            updateRectCircleSize();
                

            link.select('path').attr("d", d => {
                let route = cola.makeEdgeBetween(d.source.innerBounds, d.target.innerBounds, 5);
                return lineFunction([route.sourceIntersection, route.arrowStart]);
            });
            if (isIE()) link.each(function (d) { this.parentNode.insertBefore(this, this) });

            link.select('text')
                .attr('x', d => {
                    let route = cola.makeEdgeBetween(d.source.innerBounds, d.target.innerBounds, 5);
                    return (route.sourceIntersection.x + route.targetIntersection.x)/2
                })
                .attr('y', d => {
                    let route = cola.makeEdgeBetween(d.source.innerBounds, d.target.innerBounds, 5);
                    return (route.sourceIntersection.y + route.targetIntersection.y)/2;
                })

        }).on("end", routeEdges);
        function isIE() { return ((navigator.appName == 'Microsoft Internet Explorer') || ((navigator.appName == 'Netscape') && (new RegExp("Trident/.*rv:([0-9]{1,}[\.0-9]{0,})").exec(navigator.userAgent) != null))); }
    }

    // Helper function for updating links after node mutations.
    // Calls a function after links added.
    function createNewLinks(){
        tripletsDB.get({}, (err, l) => {
            if (err){
                throw new Error(err);
            }
            // Create edges based on LevelGraph triplets
            links = l.map(({subject, object, edgeData}) => {
                let source = nodeMap.get(subject);
                let target = nodeMap.get(object);
                return { source, target, edgeData }
            });   
            restart()
        })
    }

    /**
     * Take a node object or list of nodes and add them.
     * @param {object | object[]} nodeObject 
     */
    function addNode(nodeObjectOrArray){
        /** Define helper functions at the top */
        /**
         * Checks if object is an array:
         * http://stackoverflow.com/a/34116242/6421793
         * @param {object|array} obj 
         */
        function isArray(obj){
            return !!obj && obj.constructor === Array;
        }
        function addNodeObjectHelper(nodeObject){
            // Check that hash exists
            if (!(nodeObject.hash)) {
                var e = new Error("Node requires a hash field.");
                console.error(e);
                return
            }
            

            // Add node to graph
            if (!nodeMap.has(nodeObject.hash)){
                simulation.stop();
                // Set the node
                nodes.push(nodeObject)
                nodeMap.set(nodeObject.hash, nodeObject);
            }
        }

        /**
         * Check that the input is valid
         */
        if (typeof nodeObjectOrArray !== "object"){
            var e = new Error("Parameter must be either an object or an array");
            console.error(e);
            return
        }
        if (isArray(nodeObjectOrArray)){
            // Run through the array adding the nodes
            nodeObjectOrArray.forEach(addNodeObjectHelper)
        } else {
            addNodeObjectHelper(nodeObjectOrArray);
        }
        
        // Draw the changes.
        restart();
    }

    /**
     * Validates triplets.
     * @param {object} tripletObject 
     */
    function tripletValidation(tripletObject){
        /**
         * Check that minimum requirements are met.
         */
        if (tripletObject === undefined) {
            var e = new Error("TripletObject undefined");
            console.error(e);
            return false
        }

        // Node needs a unique hash associated with it.
        let subject = tripletObject.subject,
            predicate = tripletObject.predicate,
            object = tripletObject.object;

        if (!(subject && predicate && object && true)){
            throw new Error("Triplets added need to include all three fields.")
            return false
        }

        // Check that hash exists
        if (!(subject.hash && object.hash)) {
            var e = new Error("Subject and Object require a hash field.");
            console.error(e);
            return false
        }

        // Check that type field exists on predicate
        if (!predicate.type) {
            var e = new Error("Predicate requires type field.");
            console.error(e);
            return false
        }

        // Check that type field is a string on predicate
        if (typeof predicate.type !== "string") {
            var e = new Error("Predicate type field must be a string");
            console.error(e);
            return false
        }
        return true
    }

    /**
     * Adds a triplet object. Adds the node if it's not already added.
     * Otherwise it just adds the edge
     * @param {object} tripletObject 
     */
    function addTriplet(tripletObject){
        if (!tripletValidation(tripletObject)){
            return
        }
        // Node needs a unique hash associated with it.
        let subject = tripletObject.subject,
            predicate = tripletObject.predicate,
            object = tripletObject.object;
        
        // Check that predicate doesn't already exist
        new Promise((resolve, reject) => tripletsDB.get({subject: subject.hash,
            predicate: predicate.type,
            object: object.hash}, function(err, list){
                if (err) reject(err);
                resolve(list.length === 0);
            })).then(doesntExist => {
                if (!doesntExist){
                    return new Error("That edge already exists. Hashs' and predicate type needs to be unique!")
                }
                 /**
                 * If a predicate type already has a color,
                 * it is not redefined.
                 */
                if (!predicateTypeToColorMap.has(layoutOptions.edgeColor(predicate))){
                    predicateTypeToColorMap.set(layoutOptions.edgeColor(predicate), true);

                    // Create an arrow head for the new color
                    createColorMarker(defs, layoutOptions.edgeColor(predicate));
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
                }, err => {
                    if (err){
                        throw new Error(err);
                    }
                    
                    // Add nodes to graph
                    simulation.stop();
                    if (!nodeMap.has(subject.hash)){
                        // Set the node
                        nodes.push(subject)
                        nodeMap.set(subject.hash, subject);
                    }
                    if (!nodeMap.has(object.hash)){
                        nodes.push(object)
                        nodeMap.set(object.hash, object);
                    }

                    createNewLinks();
                });
            });
    }

    function addEdge(triplet){
        if (!tripletValidation(triplet)){
            return
        }
        // Node needs a unique hash associated with it.
        let subject = triplet.subject,
            predicate = triplet.predicate,
            object = triplet.object;
        
        if (!(nodeMap.has(subject.hash) && nodeMap.has(object.hash))){
            // console.error("Cannot add edge between nodes that don't exist.")
            return
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
        }, err => {
            if (err){
                throw new Error(err);
            }

            createNewLinks();
        });

    }

    /**
     * Removes the node and all triplets associated with it.
     * @param {String} nodeHash hash of the node to remove.
     */
    function removeNode(nodeHash){
        tripletsDB.get({subject: nodeHash}, function(err, l1){
            if (err){
                return console.error(err)
            }
            tripletsDB.get({object: nodeHash}, function(err, l2){
                if (err){
                    return console.error(err)
                }
                // Check if the node exists
                if (l1.length + l2.length === 0){
                    return console.error("There was nothing to remove")
                }

                [...l1, ...l2].forEach(triplet => tripletsDB.del(triplet, function(err){
                    if (err){
                        return console.error(err);
                    }
                }));
                tripletsDB.del([...l1, ...l2], function(err){
                    if (err) { return new Error(err)};

                    // Once the edges are deleted we can remove the node.
                    let nodeIndex = -1;
                    for (let i = 0; i < nodes.length; i++){
                        if (nodes[i].hash === nodeHash){
                            nodeIndex = i;
                            break;
                        }
                    }
                    if (nodeIndex === -1){
                        return console.error("There is no node");
                    }
                    simulation.stop();
                    nodes.splice(nodeIndex, 1);
                    nodeMap.delete(nodeHash);

                    createNewLinks();
                });
            });
        });
    }

    function setNodeToColor(nodeToColorFunc){
        layoutOptions.nodeToColor = nodeToColorFunc;
    }
    function nodeStrokeWidth(nodeStrokeWidthFunc){
        layoutOptions.nodeStrokeWidth = nodeStrokeWidthFunc;
    }
    function nodeStrokeColor(nodeStrokeColor){
        layoutOptions.nodeStrokeColor = nodeStrokeColor;
    }
    

    /**
     * Function that fires when a node is clicked.
     * @param {function} selectNodeFunc 
     */
    function setSelectNode(selectNodeFunc){
        layoutOptions.clickNode = selectNodeFunc;
    }

    /**
     * Invoking this function will recenter the graph.
     */
    function recenterGraph(){
        svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(1))
    }

    /**
     * Replaces function to call when clicking away from a node.
     * TODO: prevent triggering when zooming.
     * @param {function} clickAwayCallback 
     */
    function setClickAway(clickAwayCallback){
        layoutOptions.clickAway = clickAwayCallback;
    }

    /**
     * Function called when choosing edge color based on predicate.
     * @param {function} edgeColorCallback takes string 'predicate.type' to a color.
     */
    function setEdgeColor(edgeColorCallback){
        layoutOptions.edgeColor = edgeColorCallback;
    }

    /**
     * Function called when choosing a stroke width.
     * Takes the edge object {source, edgeData, target} and returns a number
     * @param {function} edgeStrokeCallback 
     */
    function setEdgeStroke(edgeStrokeCallback){
        layoutOptions.edgeStroke = edgeStrokeCallback;
    }

    /**
     * Function for setting the ideal edge lengths.
     * This takes an edge object and should return a number.
     * Edge object has the following shape: {source, edgeData, target}.
     * This will become the min length.
     */
    function setEdgeLength(edgeLengthCallback){
        layoutOptions.edgeLength = edgeLengthCallback;
        restart();
    }

    /**
     * Function to call when mouse over registers on a node.
     * It takes a d3 mouse over event.
     * @param {function} mouseOverCallback 
     */
    function setMouseOver(mouseOverCallback){
        layoutOptions.mouseOverNode = mouseOverCallback;
    }

    /**
     * Function to call when mouse out registers on a node.
     * It takes a d3 mouse over event.
     * @param {function} mouseOutCallback 
     */
    function setMouseOut(mouseOutCallback){
        layoutOptions.mouseOutNode = mouseOutCallback;
    }

    /**
     * Function for updating webcola options.
     * Returns a new simulation and uses the defined layout variable.
     */
    function updateColaLayout(){
        let tempSimulation = cola.d3adaptor(d3)
                         .size([width, height])
                         .avoidOverlaps(layoutOptions.avoidOverlaps)
                         .handleDisconnected(layoutOptions.handleDisconnected);
        
        // TODO: Work out what's up with the edge length.
        switch (layoutOptions.layoutType){
            case "jaccardLinkLengths":
                // layoutOptions.edgeLength needs to be a number for jaccard to work.
                if (layoutOptions.edgeLength === "undefined" || typeof layoutOptions.edgeLength !== "number"){
                    console.error("'edgeLength' needs to be set to a number for jaccardLinkLengths to work properly")
                }
                tempSimulation = tempSimulation.jaccardLinkLengths(layoutOptions.edgeLength)
                break;
            case "flowLayout":
                if (layoutOptions.edgeLength === "undefined" || !(typeof layoutOptions.edgeLength === "number" || typeof layoutOptions.edgeLength === "function")){
                    console.error("'edgeLength' needs to be set to a number or function for flowLayout to work properly")
                }
                tempSimulation = tempSimulation.flowLayout(layoutOptions.flowDirection, layoutOptions.edgeLength);
                break;
            case "linkDistance":
            default:
                tempSimulation = tempSimulation.linkDistance(layoutOptions.edgeLength);
                break;
        }
        // Bind the nodes and links to the simulation
        return tempSimulation.nodes(nodes)
                            .links(links);
                         
    }

    // Public api
    return {
        getSVGElement: () => svg,
        addTriplet,
        addEdge,
        removeNode,
        addNode,
        setClickAway,
        recenterGraph,
        restart: {
            styles: updateStyles,
            layout: restart,
        },
        nodeOptions: {
            setNodeColor: setNodeToColor,
            nodeStrokeWidth,
            nodeStrokeColor,
            setMouseOver,
            setMouseOut
        },
        edgeOptions: {
            setStrokeWidth: setEdgeStroke,
            setLength: setEdgeLength,
            setColor: setEdgeColor
        },
        colaOptions: {
            flowLayout: {
                down: () => {
                    layoutOptions.flowDirection = 'y';
                    if (layoutOptions.layoutType == "flowLayout"){
                        simulation.flowLayout(layoutOptions.flowDirection, layoutOptions.edgeLength);
                    } else {
                        layoutOptions.layoutType = "flowLayout";
                        simulation = updateColaLayout();
                    }

                    restart();
                },
                right: () => {
                    layoutOptions.flowDirection = 'x';
                    if (layoutOptions.layoutType == "flowLayout"){
                        simulation.flowLayout(layoutOptions.flowDirection, layoutOptions.edgeLength);
                    } else {
                        layoutOptions.layoutType = "flowLayout";
                        simulation = updateColaLayout();
                    }
                    
                    restart();
                }
            }
        }
    }
}
