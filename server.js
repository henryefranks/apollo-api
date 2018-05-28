'use strict';

// Imports
const	express						= require('express'),
		app							= express(),
		port						= 4000,
		config						= require('./config'),

		auth						= require('./middleware').auth,
		mongo						= require('./mongo'),
		bodyParser					= require('body-parser'),
		helmet						= require('helmet');
var client;

// Connect to MongoDB
mongo.connect((err) => {
	if (err) {
		console.log(err.message);
		process.exit(1);
	}
	client = mongo.client();

	// Get Request Body
	app.use(bodyParser.urlencoded({extended: true}));
	app.use(bodyParser.json());

	// Protect against some well-known vulnerabilities
	app.use(helmet());

	// CORS Headers (delete in prod)
	function setCORS(res) {
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Headers", "X-Requested-With");
		return res;
	}

	app.use('/*', auth, (req, res, next) => {
		console.log("\n- - - - - -");
		console.log(new Date().toLocaleString() + ": " + req.method + " request to " + req.originalUrl + " with body:");
		console.log(req.body);
		res = setCORS(res);
		next();
	})

	// Set up routes
	require('./routes')(app);

	app.route('/').get((req, res) => {
		res.send({
			name: config.name,
			version: config.version,
			created_by: config.authors
		});
	});

	app.use((req, res) => {
		res.status(404).json({
			code: "001",
			message: req.method + " " + req.originalUrl + ' not found'
		}); // 404 return
	});

	// Error handling middleware
	app.use((err, req, res, next) => {
		console.log("An Error Occurred: " + err.message);
		res.status(err.status || 500); // Set error response status (default 500)
		res.json({
			code: "001",
			message: "An unexpected error occurred"
		});
	});

	// Start
	module.exports = app.listen(port, () => {
		console.log('Apollo API started on: ' + port);
	});
})

function cleanup() {
	if (client) client.close(); // Close the database connection
	process.exit();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
