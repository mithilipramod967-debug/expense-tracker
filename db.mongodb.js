db = db.getSiblingDB('practice');
db.dropDatabase();

print('--- create collection with validation ---');
db.createCollection('wallets', { validator: { $jsonSchema: { required: ['owner', 'balance'], properties: { balance: { minimum: 0 } } } } });
try { db.wallets.insertOne({ owner: 'Asha', balance: -5 }); } catch (e) { print(`blocked: ${e.message}`); }

print('--- CRUD ---');
db.expenses.insertMany([
  { title: 'Lunch', amount: 120, category: 'Food', date: new Date('2026-10-01'), tags: ['college'] },
  { title: 'Metro', amount: 300, category: 'Transport', date: new Date('2026-10-02'), tags: ['monthly'] },
  { title: 'Movie', amount: 450, category: 'Fun', date: new Date('2026-10-05'), tags: ['friends', 'weekend'] },
  { title: 'Groceries', amount: 1250, category: 'Food', date: new Date('2026-10-06'), tags: ['monthly'] },
]);
printjson(db.expenses.find({ amount: { $gt: 200 } }, { _id: 0, title: 1, amount: 1 }).sort({ amount: -1 }).toArray());
printjson(db.expenses.find({ $or: [{ tags: 'college' }, { title: /^m/i }] }, { _id: 0, title: 1 }).toArray());
db.expenses.updateOne({ title: 'Lunch' }, { $set: { amount: 150 }, $push: { tags: 'canteen' } });
db.expenses.updateMany({ category: 'Food' }, { $inc: { amount: 10 } });
db.expenses.deleteOne({ title: 'Metro' });
print(`count after update/delete: ${db.expenses.countDocuments()}`);

print('--- one-to-one, one-to-many, many-to-many ---');
const user = db.users.insertOne({ name: 'Riya', address: { city: 'Pune' } }).insertedId;
db.profiles.createIndex({ user: 1 }, { unique: true });
db.profiles.insertOne({ user, budget: 15000 });
const food = db.categories.insertOne({ name: 'Food', user }).insertedId;
const [t1, t2] = Object.values(db.tags.insertMany([{ name: 'friends' }, { name: 'trip' }]).insertedIds);
db.items.insertMany([
  { title: 'Pizza', amount: 600, category: food, tags: [t1], user },
  { title: 'Snacks', amount: 250, category: food, tags: [t1, t2], user },
]);
printjson(db.users.aggregate([{ $lookup: { from: 'profiles', localField: '_id', foreignField: 'user', as: 'profile' } }, { $project: { _id: 0, name: 1, budget: { $first: '$profile.budget' } } }]).toArray());
printjson(db.categories.aggregate([{ $lookup: { from: 'items', localField: '_id', foreignField: 'category', as: 'i' } }, { $project: { _id: 0, name: 1, items: '$i.title' } }]).toArray());
printjson(db.tags.aggregate([{ $lookup: { from: 'items', localField: '_id', foreignField: 'tags', as: 'i' } }, { $project: { _id: 0, name: 1, items: '$i.title' } }]).toArray());

print('--- aggregation ---');
printjson(db.expenses.aggregate([
  { $group: { _id: '$category', total: { $sum: '$amount' }, avg: { $avg: '$amount' }, count: { $sum: 1 } } },
  { $sort: { total: -1 } },
]).toArray());
printjson(db.expenses.aggregate([{ $unwind: '$tags' }, { $group: { _id: '$tags', uses: { $sum: 1 } } }, { $sort: { uses: -1 } }]).toArray());
printjson(db.expenses.aggregate([{ $facet: {
  buckets: [{ $bucket: { groupBy: '$amount', boundaries: [0, 200, 1000, 1e9] } }],
  top: [{ $sort: { amount: -1 } }, { $limit: 1 }, { $project: { _id: 0, title: 1 } }],
} }]).toArray());

print('--- indexes ---');
db.expenses.createIndex({ category: 1, date: -1 });
print(db.expenses.find({ category: 'Food' }).explain().queryPlanner.winningPlan.inputStage.stage);
printjson(db.expenses.getIndexes().map((i) => i.name));
printjson({ collections: db.stats().collections, dataSize: db.stats().dataSize });

db.dropDatabase();
print('dropped practice database');
