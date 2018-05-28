'use strict';

// Mongo Setup
const	mongo	=		require('../mongo'),
		config	=		require('../config'),
		db		=		mongo.db(),
		client	=		mongo.client();

// Import middleware
const asyncHandler = require('../middleware/asyncHandler');

// Book info

exports.getBook = asyncHandler(async function(req, res) {
	const book = await db.collection('books').findOne({_id: req.params.bookID});
	if (!book) {
		res.json({error: "Book doesn't exist"});
		return;
	}

	res.json({message: "success", book: book});
});

exports.editBook = asyncHandler(async function(req, res) {
	const book = await db.collection('books').findOne({_id: req.params.bookID});
	if (!book) {
		res.json({error: "Book doesn't exist"});
		return;
	}

	try {
		await db.collection('books').updateOne({_id: book._id}, {$set: {
			title: req.body.title || book.title,
			author: req.body.author || book.author,
			tags: req.body.tags || book.tags
		}});
	} catch (err) {
		console.log(err);
		res.json({error: "Couldn't edit book"});
		return;
	}

	res.json({message: "success"});
});

exports.deleteBook = asyncHandler(async function(req, res) {
	const book = await db.collection('books').findOne({_id: req.params.bookID});
	if (!book) {
		res.json({error: "Book doesn't exist"});
		return;
	}

	try {
		await db.collection('books').remove({_id: book._id});
	} catch (err) {
		console.log(err);
		res.json({error: "Couldn't delete book"});
		return;
	}

	res.json({message: "success"});
});

// Book loaning and management

exports.withdrawBook = asyncHandler(async (req, res) => {
	if (!req.body.userID) {
		res.json({error: "No user ID specified"});
		return;
	}

	if (!req.body.due) {
		res.json({error: "No due date specified"});
		return;
	}

	const user = await db.collection('users').findOne({_id: req.body.userID});
	if (!user) {
		res.json({error: "User doesn't exist"});
		return;
	}

	const book = await db.collection('books').findOne({_id: req.params.bookID});
	if (!book) {
		res.json({error: "Book doesn't exist"});
		return;
	}

	if (book.loanID) {
		res.json({error: "Book already on loan"});
		return;
	}

	const reservation = book.reservationID ? await db.collection('reservations').findOne({_id: book.reservationID}) : null;

	if (reservation && reservation.userID != user._id) {
		res.json({error: "Book reserved"});
		return;
	}

	client.withSession(async session => {
		session.startTransaction();

		try {
			const loanID = (await db.collection('loans').insertOne({
				userID: user._id,
				bookID: book._id,
				due: new Date(req.body.due)
			}, {session})).ops[0]._id;

			await db.collection('users').updateOne({_id: req.body.userID}, {$push: {
				loanIDs: loanID
			}, $pull: {
				reservationIDs: book.reservationID
			}}, {session});

			await db.collection('books').updateOne({_id: req.params.bookID}, {$set: {
				loanID: loanID
			}, $unset : {
				reservationID: null
			}}, {session});

			await db.collection('reservations').remove({_id: book.reservationID})
		} catch (err) {
			if (err) console.log(err.message);
			session.abortTransaction();
			res.json({error: "Couldn't withdraw book"});
			return;
		}

		await session.commitTransaction();
	}).then(() =>
		res.json({message: "success"})
	);
});

exports.depositBook = asyncHandler(async (req, res) => {
	if (!req.body.userID) {
		res.json({error: "No user ID specified"});
		return;
	}

	const user = await db.collection('users').findOne({_id: req.body.userID});
	if (!user) {
		res.json({error: "User doesn't exist"});
		return;
	}

	const book = await db.collection('books').findOne({_id: req.params.bookID});
	if (!book) {
		res.json({error: "Book doesn't exist"});
		return;
	}
	if (!book.loanID) {
		res.json({error: "Book not on loan"});
		return;
	}

	const loan = await db.collection('loans').findOne({_id: book.loanID});
	if (!loan) {
		res.json({error: "Loan doesn't exist"});
		return;
	}

	client.withSession(async session => {
		session.startTransaction();

		try {
			await db.collection('loans').updateOne({_id: loan._id}, {$set: {
				returnDate: new Date()
			}}, {session});

			await db.collection('users').updateOne({_id: user._id}, {$pull: {
				loanIDs: loan._id
			}}, {session});

			await db.collection('books').updateOne({_id: book._id}, {$unset: {
				loanID: null
			}}, {session});
		} catch (err) {
			if (err) console.log(err.message);
			session.abortTransaction();
			res.json({error: "Couldn't deposit book"});
			return;
		}

		await session.commitTransaction();
	}).then(() =>
		res.json({message: "success"})
	);
});

exports.reserveBook = asyncHandler(async (req, res) => {
	if (!req.body.userID) {
		res.json({error: "No user ID specified"});
		return;
	}

	const user = await db.collection('users').findOne({_id: req.body.userID});
	if (!user) {
		res.json({error: "User doesn't exist"});
		return;
	}

	if (user.reservationIDs && user.reservationIDs.length >= config.reservationLimit) {
		res.json({error: "Too many books already reserved"});
		return;
	}

	const book = await db.collection('books').findOne({_id: req.params.bookID});
	if (!book) {
		res.json({error: "Book doesn't exist"});
		return;
	}

	if (book.reservationID) {
		res.json({error: "Book already reserved"});
		return;
	}

	client.withSession(async session => {
		session.startTransaction();

		try {
			const reservationID = (await db.collection('reservations').insertOne({
				userID: user._id,
				bookID: book._id
			}, {session})).ops[0]._id;

			await db.collection('users').updateOne({_id: req.body.userID}, {$push: {
				reservationIDs: reservationID
			}}, {session});

			await db.collection('books').updateOne({_id: req.params.bookID}, {$set: {
				reservationID: reservationID
			}}, {session});
		} catch (err) {
			if (err) console.log(err.message);
			session.abortTransaction();
			res.json({error: "Couldn't reserve book"});
			return;
		}

		await session.commitTransaction();
	}).then(() =>
		res.json({message: "success"})
	);
});

exports.getReservation = asyncHandler(async (req, res) => {
	const book = await db.collection('books').findOne({_id: req.params.bookID});
	if (!book) {
		res.json({error: "Book doesn't exist"});
		return;
	}
	if (!book.reservationID) {
		res.json({error: "Book not reserved"});
		return;
	}

	const reservation = await db.collection('reservations').findOne({_id: book.reservationID});
	if (!reservation) {
		res.json({error: "Reservation doesn't exist"});
		return;
	}

	res.json({message: "success", reservation: reservation});
});

exports.deleteReservation = asyncHandler(async (req, res) => {
	if (!req.body.userID) {
		res.json({error: "No user ID specified"});
		return;
	}

	const user = await db.collection('users').findOne({_id: req.body.userID});
	if (!user) {
		res.json({error: "User doesn't exist"});
		return;
	}

	const book = await db.collection('books').findOne({_id: req.params.bookID});
	if (!book) {
		res.json({error: "Book doesn't exist"});
		return;
	}
	if (!book.reservationID) {
		res.json({error: "Book not reserved"});
		return;
	}

	const reservation = await db.collection('reservations').findOne({_id: book.reservationID});
	if (!reservation) {
		res.json({error: "Reservation doesn't exist"});
		return;
	}

	client.withSession(async session => {
		session.startTransaction();

		try {
			await db.collection('reservations').remove({_id: reservation._id}, {session});

			await db.collection('users').updateOne({_id: user._id}, {$pull: {
				reservationIDs: reservation._id
			}}, {session});

			await db.collection('books').updateOne({_id: book._id}, {$unset: {
				reservationID: null
			}}, {session});
		} catch (err) {
			if (err) console.log(err.message);
			session.abortTransaction();
			res.json({error: "Couldn't remove reservation"});
			return;
		}

		await session.commitTransaction();
	}).then(() =>
		res.json({message: "success"})
	);
});

exports.renewBook = asyncHandler(async (req, res) => {
    if (!req.body.userID) {
		res.json({error: "No user ID specified"});
		return;
	}
	
	if (!req.body.due) {
		res.json({error: "No due date specified"});
		return;
	}

	const user = await db.collection('users').findOne({_id: req.body.userID});
	if (!user) {
		res.json({error: "User doesn't exist"});
		return;
	}

	const book = await db.collection('books').findOne({_id: req.params.bookID});
	if (!book) {
		res.json({error: "Book doesn't exist"});
		return;
	}

	if (!book.loanID) {
		res.json({error: "Book not on loan"});
		return;
	}

	try {
		await db.collection('loans').updateOne({_id: book.loanID}, {$set: {
			due: new Date(req.body.due)
		}});
	} catch (err) {
		console.log(err);
		res.json({error: "Couldn't renew book"});
		return;
	}
	res.json({message: "success"});
});

// Loans information
exports.getCurrentLoan = asyncHandler(async function(req, res) {
	const book = await db.collection('books').findOne({_id: req.params.bookID});
	if (!book) {
		res.json({error: "Book doesn't exist"});
		return;
	}

	if (!book.loanID) {
		res.json({error: "Book not on loan"});
		return;
	}

	const loan = await db.collection('loans').findOne({_id: book.loanID});
    res.json({message: "success", loan: loan});
});

// History

exports.getBookHistory = asyncHandler(async function(req, res) {
	res.json({function: "getBookHistory", bookID: req.params.bookID});
});

exports.getBookHistoryUsers = asyncHandler(async function(req, res) {
	res.json({function: "getBookHistoryUsers", bookID: req.params.bookID});
});
