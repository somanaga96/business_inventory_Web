import { initializeApp } from 'firebase/app'

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
)

const app = firebaseConfigured
  ? initializeApp(firebaseConfig)
  : null

export const db = app
  ? getFirestore(app)
  : null

// ============================================================
// COLLECTIONS
// ============================================================

const productsCollection = () =>
  collection(db, 'products')

const inventoryCollection = () =>
  collection(db, 'inventory')

const historyCollection = () =>
  collection(db, 'inventoryHistory')

// ============================================================
// PRODUCTS
// ============================================================

export function subscribeToProducts(
  onChange,
  onError
) {
  return onSnapshot(
    productsCollection(),
    (snapshot) => {
      const products = snapshot.docs
        .map((item) => ({
          id: item.id,
          ...item.data(),
        }))
        .sort((a, b) => {
          const aTime =
            a.createdAt?.toMillis?.() || 0

          const bTime =
            b.createdAt?.toMillis?.() || 0

          return bTime - aTime
        })

      onChange(products)
    },
    onError
  )
}

export function addProduct(product) {
  return addDoc(
    productsCollection(),
    {
      ...product,

      threshold: Number(
        product.threshold ?? 10
      ),

      createdAt:
        serverTimestamp(),

      updatedAt:
        serverTimestamp(),
    }
  )
}

export function updateProduct(
  id,
  product
) {
  return updateDoc(
    doc(db, 'products', id),
    {
      ...product,

      threshold: Number(
        product.threshold ?? 10
      ),

      updatedAt:
        serverTimestamp(),
    }
  )
}

export async function deleteProduct(id) {
  // Delete product
  await deleteDoc(
    doc(db, 'products', id)
  )

  // Delete its inventory record
  await deleteDoc(
    doc(db, 'inventory', id)
  )
}

// ============================================================
// INVENTORY
//
// One inventory document per product.
//
// inventory/{productId}
//
// Example:
//
// {
//   productId: "abc",
//   name: "Egg",
//   quantity: 70,
//   costValue: 350,
//   avgCost: 5
// }
// ============================================================

export function subscribeToInventory(
  onChange,
  onError
) {
  return onSnapshot(
    inventoryCollection(),
    (snapshot) => {
      const records = snapshot.docs
        .map((item) => ({
          id: item.id,
          ...item.data(),
        }))

      const byProduct =
        new Map()

      records.forEach(
        (record) => {
          const key =
            record.productId ||
            record.id

          const existing =
            byProduct.get(key)

          // Prefer new model where
          // document ID = product ID.
          if (
            !existing ||
            record.id === record.productId
          ) {
            byProduct.set(
              key,
              record
            )
          }
        }
      )

      const inventory =
        [...byProduct.values()]
          .sort((a, b) => {
            const aTime =
              a.updatedAt?.toMillis?.() || 0

            const bTime =
              b.updatedAt?.toMillis?.() || 0

            return bTime - aTime
          })

      onChange(inventory)
    },
    onError
  )
}

// ============================================================
// TRANSACTION CALCULATION
// ============================================================

function calculateTransaction({
  action,
  quantity,
  price,
  currentQuantity,
  currentCostValue,
}) {
  const qty =
    Number(quantity)

  const unitPrice =
    Number(price)

  const oldQty =
    Number(currentQuantity || 0)

  const oldCost =
    Number(currentCostValue || 0)

  if (
    !Number.isFinite(qty) ||
    qty <= 0
  ) {
    throw new Error(
      'Quantity must be greater than zero.'
    )
  }

  if (
    !Number.isFinite(unitPrice) ||
    unitPrice < 0
  ) {
    throw new Error(
      'Price must be zero or greater.'
    )
  }

  // Weighted average purchase cost
  const averageCost =
    oldQty > 0
      ? oldCost / oldQty
      : 0

  // ==========================================================
  // PURCHASE
  // ==========================================================

  if (action === 'Purchase') {
    const inventoryCostChange =
      qty * unitPrice

    return {
      quantityAfter:
        oldQty + qty,

      costValueAfter:
        oldCost +
        inventoryCostChange,

      inventoryCostChange,

      salesRevenue: 0,

      cogs: 0,

      transactionValue:
        inventoryCostChange,
    }
  }

  // ==========================================================
  // SALE
  // ==========================================================

  if (action === 'Sale') {
    if (qty > oldQty) {
      throw new Error(
        `Cannot sell ${qty} units. Only ${oldQty} are available.`
      )
    }

    // Selling price does NOT determine
    // inventory value.
    //
    // Example:
    //
    // Buy 100 @ ₹5
    // Sell 30 @ ₹7
    //
    // Revenue = ₹210
    // COGS = ₹150
    // Remaining inventory = 70 × ₹5 = ₹350

    const cogs =
      qty * averageCost

    const salesRevenue =
      qty * unitPrice

    return {
      quantityAfter:
        oldQty - qty,

      costValueAfter:
        Math.max(
          0,
          oldCost - cogs
        ),

      inventoryCostChange:
        -cogs,

      salesRevenue,

      cogs,

      transactionValue:
        salesRevenue,
    }
  }

  // ==========================================================
  // RETURN
  // ==========================================================

  if (action === 'Return') {
    const inventoryCostChange =
      oldQty > 0
        ? qty * averageCost
        : qty * unitPrice

    const refundValue =
      qty * unitPrice

    return {
      quantityAfter:
        oldQty + qty,

      costValueAfter:
        oldCost +
        inventoryCostChange,

      inventoryCostChange,

      salesRevenue:
        -refundValue,

      cogs: 0,

      transactionValue:
        refundValue,
    }
  }

  // ==========================================================
  // DAMAGE
  // ==========================================================

  if (action === 'Damage') {
    if (qty > oldQty) {
      throw new Error(
        `Cannot damage ${qty} units. Only ${oldQty} are available.`
      )
    }

    const inventoryCostChange =
      qty * averageCost

    return {
      quantityAfter:
        oldQty - qty,

      costValueAfter:
        Math.max(
          0,
          oldCost -
            inventoryCostChange
        ),

      inventoryCostChange:
        -inventoryCostChange,

      salesRevenue: 0,

      cogs: 0,

      transactionValue:
        inventoryCostChange,
    }
  }

  // ==========================================================
  // ADJUSTMENT
  // ==========================================================

  if (action === 'Adjustment') {
    const newCostValue =
      qty * unitPrice

    return {
      quantityAfter:
        qty,

      costValueAfter:
        newCostValue,

      inventoryCostChange:
        newCostValue -
        oldCost,

      salesRevenue: 0,

      cogs: 0,

      transactionValue:
        Math.abs(
          newCostValue -
            oldCost
        ),
    }
  }

  throw new Error(
    `Unsupported transaction type: ${action}`
  )
}

// ============================================================
// APPLY INVENTORY TRANSACTION
// ============================================================

export async function applyInventoryTransaction({
  product,
  action,
  quantity,
  price,
  supplier = '',
  note = '',
  transactionDate,
}) {
  if (!db) {
    throw new Error(
      'Firebase is not configured.'
    )
  }

  if (!transactionDate) {
    throw new Error(
      'Transaction date is required.'
    )
  }

  // One inventory document per product
  const inventoryRef =
    doc(
      db,
      'inventory',
      product.id
    )

  // New history document
  const historyRef =
    doc(
      collection(
        db,
        'inventoryHistory'
      )
    )

  // Convert YYYY-MM-DD
  // into Firestore Timestamp.
  //
  // Using local noon avoids timezone
  // shifting the date backwards/forwards.
  const [
    year,
    month,
    day,
  ] =
    transactionDate
      .split('-')
      .map(Number)

  const businessDate =
    new Date(
      year,
      month - 1,
      day,
      12,
      0,
      0
    )

  const transactionTimestamp =
    Timestamp.fromDate(
      businessDate
    )

  let result

  await runTransaction(
    db,
    async (transaction) => {

      // --------------------------------------------------------
      // READ CURRENT INVENTORY
      // --------------------------------------------------------

      const inventorySnapshot =
        await transaction.get(
          inventoryRef
        )

      const current =
        inventorySnapshot.exists()
          ? inventorySnapshot.data()
          : {}

      // --------------------------------------------------------
      // CALCULATE
      // --------------------------------------------------------

      const calculation =
        calculateTransaction({
          action,
          quantity,
          price,

          currentQuantity:
            current.quantity,

          currentCostValue:
            current.costValue,
        })

      // --------------------------------------------------------
      // INVENTORY DATA
      // --------------------------------------------------------

      const inventoryData = {
        productId:
          product.id,

        name:
          product.name,

        category:
          product.category,

        imageUrl:
          product.imageUrl || '',

        threshold:
          Number(
            product.threshold ?? 10
          ),

        quantity:
          calculation.quantityAfter,

        // Actual purchase-cost value
        costValue:
          calculation.costValueAfter,

        // Weighted average purchase cost
        avgCost:
          calculation.quantityAfter > 0
            ? calculation.costValueAfter /
              calculation.quantityAfter
            : 0,

        // Last purchase price
        lastBuyPrice:
          action === 'Purchase'
            ? Number(price)
            : Number(
                current.lastBuyPrice || 0
              ),

        updatedAt:
          serverTimestamp(),
      }

      // --------------------------------------------------------
      // UPDATE INVENTORY
      // --------------------------------------------------------

      transaction.set(
        inventoryRef,
        inventoryData,
        {
          merge: true,
        }
      )

      // --------------------------------------------------------
      // HISTORY
      // --------------------------------------------------------

      transaction.set(
        historyRef,
        {
          productId:
            product.id,

          productName:
            product.name,

          productImageUrl:
            product.imageUrl || '',

          action,

          quantity:
            Number(quantity),

          unitPrice:
            Number(price),

          transactionValue:
            calculation.transactionValue,

          salesRevenue:
            calculation.salesRevenue,

          cogs:
            calculation.cogs,

          inventoryCostChange:
            calculation.inventoryCostChange,

          inventoryQuantityAfter:
            calculation.quantityAfter,

          inventoryValueAfter:
            calculation.costValueAfter,

          supplier,

          note,

          // Business date
          transactionDate:
            transactionTimestamp,

          // Actual time entered
          createdAt:
            serverTimestamp(),
        }
      )

      result = {
        ...calculation,

        inventoryId:
          inventoryRef.id,

        historyId:
          historyRef.id,
      }
    }
  )

  return result
}

// ============================================================
// TRANSACTION HISTORY
// ============================================================

export function subscribeToHistory(
  onChange,
  onError
) {
  return onSnapshot(
    historyCollection(),
    (snapshot) => {
      const history =
        snapshot.docs
          .map((item) => ({
            id: item.id,
            ...item.data(),
          }))
          .sort((a, b) => {
            const aTime =
              a.transactionDate?.toMillis?.() ||
              a.createdAt?.toMillis?.() ||
              0

            const bTime =
              b.transactionDate?.toMillis?.() ||
              b.createdAt?.toMillis?.() ||
              0

            return bTime - aTime
          })

      onChange(history)
    },
    onError
  )
}