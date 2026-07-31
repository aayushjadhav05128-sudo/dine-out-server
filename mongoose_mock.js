const Module = require('module');
const originalRequire = Module.prototype.require;
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'db');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Memory db storage
const db = {};

function adjustDatesToRealTime(name, data) {
  if (!Array.isArray(data)) return data;
  
  const today = new Date();
  const formatIsoDate = (d) => d.toISOString().split('T')[0];
  const formatBookingTime = (d, timeStr) => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()} at ${timeStr}`;
  };

  if (name.toLowerCase() === 'booking') {
    return data.map(booking => {
      if (booking.booking_time && typeof booking.booking_time === 'string' && (booking.booking_time.includes('2026-06-') || booking.booking_time.includes('2026-07-') || booking.booking_time.includes(' at '))) {
        // Extract time slot (e.g. 08:30 PM)
        const timePart = booking.booking_time.split(' at ')[1] || '08:00 PM';
        
        // Find existing day offset from July 16, 2026 (or just default based on booking status/id)
        const targetDate = new Date(today);
        if (booking.status === 'upcoming' || booking.status === 'confirmed') {
          targetDate.setDate(today.getDate() + 1); // Tomorrow
        } else if (booking.id === 5002) {
          targetDate.setDate(today.getDate()); // Today
        } else if (booking.id === 5003) {
          targetDate.setDate(today.getDate() - 1); // Yesterday
        } else {
          targetDate.setDate(today.getDate() - 2); // 2 days ago
        }
        
        booking.booking_time = formatBookingTime(targetDate, timePart);
      }
      return booking;
    });
  }

  if (name.toLowerCase() === 'offer') {
    return data.map(offer => {
      if (offer.id === 'O-1') {
        const start = new Date(today); start.setDate(today.getDate() - 15);
        const end = new Date(today); end.setDate(today.getDate() + 15);
        offer.startsAt = formatIsoDate(start);
        offer.endsAt = formatIsoDate(end);
      } else if (offer.id === 'O-2') {
        const start = new Date(today); start.setDate(today.getDate() - 30);
        const end = new Date(today); end.setDate(today.getDate() + 30);
        offer.startsAt = formatIsoDate(start);
        offer.endsAt = formatIsoDate(end);
      } else if (offer.id === 'O-3') {
        const start = new Date(today); start.setDate(today.getDate() - 20);
        const end = new Date(today); end.setDate(today.getDate() - 5);
        offer.startsAt = formatIsoDate(start);
        offer.endsAt = formatIsoDate(end);
      } else if (offer.id === 'O-4') {
        const start = new Date(today); start.setDate(today.getDate() - 45);
        const end = new Date(today); end.setDate(today.getDate() - 15);
        offer.startsAt = formatIsoDate(start);
        offer.endsAt = formatIsoDate(end);
      }
      return offer;
    });
  }

  if (name.toLowerCase() === 'settlement') {
    return data.map(settlement => {
      const targetDate = new Date(today);
      if (settlement.id === 'S-9003') {
        targetDate.setDate(today.getDate() - 1);
      } else if (settlement.id === 'S-9002') {
        targetDate.setDate(today.getDate() - 2);
      } else {
        targetDate.setDate(today.getDate() - 5);
      }
      settlement.date = formatIsoDate(targetDate);
      return settlement;
    });
  }

  return data;
}

// Helper to get/set collections from files
function loadCollection(name) {
  const file = path.join(DB_DIR, `${name.toLowerCase()}s.json`);
  if (!db[name]) {
    if (fs.existsSync(file)) {
      try {
        db[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        db[name] = [];
      }
    } else {
      db[name] = [];
    }
  }
  db[name] = adjustDatesToRealTime(name, db[name]);
  return db[name];
}

function saveCollection(name) {
  const file = path.join(DB_DIR, `${name.toLowerCase()}s.json`);
  fs.writeFileSync(file, JSON.stringify(db[name] || [], null, 2), 'utf8');
}

function matchValue(itemVal, queryVal) {
  if (queryVal && typeof queryVal === 'object' && !Array.isArray(queryVal)) {
    for (const op in queryVal) {
      const opVal = queryVal[op];
      if (op === '$gte') {
        if (!(itemVal >= opVal)) return false;
      } else if (op === '$lte') {
        if (!(itemVal <= opVal)) return false;
      } else if (op === '$gt') {
        if (!(itemVal > opVal)) return false;
      } else if (op === '$lt') {
        if (!(itemVal < opVal)) return false;
      } else if (op === '$in') {
        if (!Array.isArray(opVal) || !opVal.includes(itemVal)) return false;
      } else if (op === '$nin') {
        if (Array.isArray(opVal) && opVal.includes(itemVal)) return false;
      } else if (op === '$ne') {
        if (itemVal == opVal) return false;
      } else if (op === '$regex') {
        const flags = queryVal['$options'] || '';
        const regex = new RegExp(opVal, flags);
        if (!regex.test(String(itemVal || ''))) return false;
      } else if (op === '$options') {
        // Handled by $regex
      } else {
        if (itemVal != opVal) return false;
      }
    }
    return true;
  }
  return itemVal == queryVal;
}

function matchQuery(item, query) {
  if (!query || Object.keys(query).length === 0) return true;
  for (const key in query) {
    const val = query[key];
    if (key === '$or') {
      if (!Array.isArray(val) || !val.some(sub => matchQuery(item, sub))) return false;
    } else if (key === '$and') {
      if (!Array.isArray(val) || !val.every(sub => matchQuery(item, sub))) return false;
    } else {
      let itemVal;
      if (key.includes('.')) {
        const parts = key.split('.');
        let current = item;
        for (const p of parts) {
          current = current ? current[p] : undefined;
        }
        itemVal = current;
      } else {
        itemVal = item[key];
      }
      
      if (!matchValue(itemVal, val)) return false;
    }
  }
  return true;
}

function wrapDocument(modelName, rawObj) {
  if (!rawObj) return null;
  if (rawObj.__isMockDocument) return rawObj;

  const doc = Object.assign({}, rawObj);
  
  Object.defineProperties(doc, {
    __isMockDocument: { value: true, enumerable: false },
    _modelName: { value: modelName, enumerable: false },
    save: {
      value: async function() {
        const collection = loadCollection(this._modelName);
        const idx = collection.findIndex(item => 
          (item._id && item._id === this._id) || (item.id && item.id === this.id)
        );
        
        const plain = Object.assign({}, this);
        
        if (idx !== -1) {
          collection[idx] = plain;
        } else {
          if (!plain._id) {
            plain._id = Math.random().toString(36).substring(2, 9);
          }
          collection.push(plain);
        }
        saveCollection(this._modelName);
        return this;
      },
      enumerable: false,
      writable: true
    },
    toObject: {
      value: function() {
        return Object.assign({}, this);
      },
      enumerable: false,
      writable: true
    },
    toJSON: {
      value: function() {
        return Object.assign({}, this);
      },
      enumerable: false,
      writable: true
    }
  });

  return doc;
}

class MockQuery {
  constructor(modelName, filter, isFindOne = false) {
    this.modelName = modelName;
    this.filter = filter;
    this.isFindOne = isFindOne;
    this._sort = null;
    this._limit = null;
    this._select = null;
    this._populate = [];
  }

  sort(sortObj) {
    this._sort = sortObj;
    return this;
  }

  limit(limitNum) {
    this._limit = limitNum;
    return this;
  }

  select(selectFields) {
    this._select = selectFields;
    return this;
  }

  populate(field) {
    this._populate.push(field);
    return this;
  }

  async exec() {
    const data = loadCollection(this.modelName);
    let matched = data.filter(item => matchQuery(item, this.filter));

    if (this._sort) {
      const keys = Object.keys(this._sort);
      matched.sort((a, b) => {
        for (const key of keys) {
          const order = this._sort[key] === -1 ? -1 : 1;
          const aVal = a[key];
          const bVal = b[key];
          if (aVal < bVal) return -1 * order;
          if (aVal > bVal) return 1 * order;
        }
        return 0;
      });
    }

    if (this._limit !== null) {
      matched = matched.slice(0, this._limit);
    }

    let docs = matched.map(doc => wrapDocument(this.modelName, doc));

    if (this._populate.length > 0) {
      for (const field of this._populate) {
        const targetModelName = field.charAt(0).toUpperCase() + field.slice(1);
        const targetData = loadCollection(targetModelName);
        for (const doc of docs) {
          const idToFind = doc[field];
          if (idToFind && typeof idToFind === 'string') {
            const referencedDoc = targetData.find(item => item._id === idToFind);
            if (referencedDoc) {
              doc[field] = wrapDocument(targetModelName, referencedDoc);
            }
          }
        }
      }
    }

    if (this.isFindOne) {
      return docs.length > 0 ? docs[0] : null;
    }

    return docs;
  }

  then(onResolve, onReject) {
    return this.exec().then(onResolve, onReject);
  }
}

class MockModel {
  constructor(data) {
    Object.assign(this, data);
    return wrapDocument(this.constructor._modelName, this);
  }

  static find(query) {
    return new MockQuery(this._modelName, query, false);
  }

  static findOne(query) {
    return new MockQuery(this._modelName, query, true);
  }

  static async aggregate(pipeline) {
    const data = loadCollection(this._modelName);
    let result = data.map(doc => wrapDocument(this._modelName, doc));

    for (const stage of pipeline) {
      if (stage.$match) {
        result = result.filter(item => matchQuery(item, stage.$match));
      } else if (stage.$sort) {
        const keys = Object.keys(stage.$sort);
        result.sort((a, b) => {
          for (const key of keys) {
            const order = stage.$sort[key] === -1 ? -1 : 1;
            const aVal = a[key] ? new Date(a[key]).getTime() : 0;
            const bVal = b[key] ? new Date(b[key]).getTime() : 0;
            if (aVal < bVal) return -1 * order;
            if (aVal > bVal) return 1 * order;
          }
          return 0;
        });
      } else if (stage.$group) {
        const idField = stage.$group._id;
        const groups = {};
        for (const item of result) {
          let keyVal = 'null';
          if (idField && idField.startsWith('$')) {
            const prop = idField.substring(1);
            keyVal = item[prop] ? (item[prop]._id || item[prop]).toString() : 'null';
          }
          if (!groups[keyVal]) {
            groups[keyVal] = { _id: keyVal };
            for (const groupKey in stage.$group) {
              if (groupKey === '_id') continue;
              const accum = stage.$group[groupKey];
              if (accum.$first) {
                const targetProp = accum.$first.substring(1);
                groups[keyVal][groupKey] = item[targetProp];
              }
            }
          }
        }
        result = Object.values(groups);
      }
    }
    return result;
  }

  static findById(id) {
    return new MockQuery(this._modelName, { _id: id }, true);
  }

  static async create(doc) {
    if (Array.isArray(doc)) {
      return Promise.all(doc.map(d => this.create(d)));
    }
    const collection = loadCollection(this._modelName);
    const plain = Object.assign({}, doc);
    if (!plain._id) {
      plain._id = Math.random().toString(36).substring(2, 9);
    }
    if (!plain.createdAt) {
      plain.createdAt = new Date().toISOString();
    }
    collection.push(plain);
    saveCollection(this._modelName);
    return wrapDocument(this._modelName, plain);
  }

  static async insertMany(docs) {
    const collection = loadCollection(this._modelName);
    const wrapped = [];
    for (const doc of docs) {
      const plain = Object.assign({}, doc);
      if (!plain._id) {
        plain._id = Math.random().toString(36).substring(2, 9);
      }
      if (!plain.createdAt) {
        plain.createdAt = new Date().toISOString();
      }
      collection.push(plain);
      wrapped.push(wrapDocument(this._modelName, plain));
    }
    saveCollection(this._modelName);
    return wrapped;
  }

  static async deleteMany(query) {
    const collection = loadCollection(this._modelName);
    const initialLen = collection.length;
    const remaining = collection.filter(item => !matchQuery(item, query));
    db[this._modelName] = remaining;
    saveCollection(this._modelName);
    return { deletedCount: initialLen - remaining.length };
  }

  static async deleteOne(query) {
    const collection = loadCollection(this._modelName);
    const idx = collection.findIndex(item => matchQuery(item, query));
    if (idx !== -1) {
      collection.splice(idx, 1);
      saveCollection(this._modelName);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }

  static async countDocuments(query) {
    const collection = loadCollection(this._modelName);
    const matched = collection.filter(item => matchQuery(item, query));
    return matched.length;
  }

  static async findOneAndUpdate(query, update, options = {}) {
    const collection = loadCollection(this._modelName);
    const idx = collection.findIndex(item => matchQuery(item, query));
    if (idx !== -1) {
      let item = collection[idx];
      if (update.$set) {
        Object.assign(item, update.$set);
      } else if (update.$inc) {
        for (const k in update.$inc) {
          item[k] = (item[k] || 0) + update.$inc[k];
        }
      } else if (update.$push) {
        for (const k in update.$push) {
          if (!Array.isArray(item[k])) item[k] = [];
          item[k].push(update.$push[k]);
        }
      } else {
        Object.assign(item, update);
      }
      saveCollection(this._modelName);
      return wrapDocument(this._modelName, item);
    }
    
    if (options.upsert) {
      const newItem = Object.assign({}, query, update.$set || update);
      if (!newItem._id) {
        newItem._id = Math.random().toString(36).substring(2, 9);
      }
      collection.push(newItem);
      saveCollection(this._modelName);
      return wrapDocument(this._modelName, newItem);
    }
    return null;
  }

  static async findByIdAndUpdate(id, update, options = {}) {
    return this.findOneAndUpdate({ _id: id }, update, options);
  }
}

const registeredModels = {};

const mockMongoose = {
  connect: async () => {
    console.log("Mock MongoDB Connected Successfully!");
    return mockMongoose;
  },
  connection: {
    host: 'localhost',
    on: (event, cb) => {
      // no error
    },
    once: (event, cb) => {
      if (event === 'open') {
        cb();
      }
    },
    close: async () => {}
  },
  Schema: class MockSchema {
    constructor(definition, options) {
      this.definition = definition;
      this.options = options;
    }
    static get Types() {
      return {
        ObjectId: String,
        Mixed: Object,
        Decimal128: Number,
        String: String,
        Number: Number,
        Boolean: Boolean,
        Date: Date,
        Buffer: Buffer,
        Map: Map,
        Array: Array
      };
    }
  },
  model: function(name, schema) {
    if (registeredModels[name]) {
      return registeredModels[name];
    }
    const modelClass = class extends MockModel {};
    modelClass._modelName = name;
    registeredModels[name] = modelClass;
    return modelClass;
  },
  Types: {
    ObjectId: function(val) {
      return val || Math.random().toString(36).substring(2, 9);
    }
  }
};

Module.prototype.require = function(id) {
  if (id === 'mongoose') {
    return mockMongoose;
  }
  return originalRequire.apply(this, arguments);
};

module.exports = mockMongoose;
