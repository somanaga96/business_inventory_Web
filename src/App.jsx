import { useEffect, useMemo, useState } from 'react'

import {
  addProduct,
  applyInventoryTransaction,
  deleteProduct,
  firebaseConfigured,
  subscribeToHistory,
  subscribeToInventory,
  subscribeToProducts,
  updateProduct,
} from './firebase'

import './App.css'

// ============================================================
// CONSTANTS
// ============================================================

const transactionTypes = [
  'Purchase',
  'Sale',
  'Return',
  'Damage',
  'Adjustment',
]

const todayString = () =>
  new Date().toISOString().split('T')[0]

const blankProduct = {
  name: '',
  category: '',
  threshold: '10',
  imageUrl: '',
}

const blankTransaction = {
  productId: '',
  action: 'Purchase',
  quantity: '',
  price: '',
  supplier: '',
  note: '',
  transactionDate: todayString(),
}

// ============================================================
// HELPERS
// ============================================================

const initials = (name = '') =>
  name
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

const money = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const stateOf = (item) => {
  const quantity = Number(item?.quantity || 0)
  const threshold = Number(item?.threshold ?? 10)

  if (quantity <= 0) return 'out'
  if (quantity <= threshold) return 'low'

  return 'ok'
}

/*
 * IMPORTANT:
 *
 * Categories are NOT hardcoded.
 *
 * They are created from the actual products stored
 * in Firestore.
 */
const getCategories = (products = []) => {
  return [
    ...new Set(
      products
        .map((product) =>
          String(product?.category || '').trim()
        )
        .filter(Boolean)
    ),
  ].sort((a, b) =>
    a.localeCompare(b, undefined, {
      sensitivity: 'base',
    })
  )
}

const timestampDate = (timestamp) => {
  if (!timestamp?.toDate) return null
  return timestamp.toDate()
}

const transactionDateOf = (entry) => {
  if (entry?.transactionDate) {
    if (typeof entry.transactionDate === 'string') {
      const date = new Date(
        `${entry.transactionDate}T00:00:00`
      )

      if (!Number.isNaN(date.getTime())) {
        return date
      }
    }

    if (entry.transactionDate?.toDate) {
      return entry.transactionDate.toDate()
    }
  }

  return timestampDate(entry?.createdAt)
}

const dateOf = (entry) => {
  const date = transactionDateOf(entry)

  if (!date) {
    return 'Saving date…'
  }

  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

const monthKey = (entry) => {
  const date = transactionDateOf(entry)

  if (!date) return ''

  return `${date.getFullYear()}-${String(
    date.getMonth() + 1
  ).padStart(2, '0')}`
}

const monthLabel = (key) => {
  if (!key) return 'No month'

  const [year, month] = key.split('-')

  return new Date(
    Number(year),
    Number(month) - 1,
    1
  ).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  })
}

const compareText = (a = '', b = '') =>
  String(a).localeCompare(
    String(b),
    undefined,
    {
      sensitivity: 'base',
    }
  )

const withinDateRange = (
  entry,
  fromDate,
  toDate
) => {
  const date = transactionDateOf(entry)

  if (!date) return false

  if (fromDate) {
    const from = new Date(
      `${fromDate}T00:00:00`
    )

    if (date < from) {
      return false
    }
  }

  if (toDate) {
    const to = new Date(
      `${toDate}T23:59:59.999`
    )

    if (date > to) {
      return false
    }
  }

  return true
}

// ============================================================
// APP
// ============================================================

function App() {
  const [products, setProducts] = useState([])
  const [inventory, setInventory] = useState([])
  const [history, setHistory] = useState([])

  const [page, setPage] =
    useState('overview')

  const [productForm, setProductForm] =
    useState(blankProduct)

  const [transactionForm, setTransactionForm] =
    useState(blankTransaction)

  const [editingProduct, setEditingProduct] =
    useState(null)

  const [message, setMessage] =
    useState('')

  const [saving, setSaving] =
    useState(false)

  // ==========================================================
  // FIREBASE LISTENERS
  // ==========================================================

  useEffect(() => {
    if (!firebaseConfigured) {
      return undefined
    }

    const stopProducts =
      subscribeToProducts(
        setProducts,
        () =>
          setMessage(
            'Could not load products.'
          )
      )

    const stopInventory =
      subscribeToInventory(
        setInventory,
        () =>
          setMessage(
            'Could not load inventory.'
          )
      )

    const stopHistory =
      subscribeToHistory(
        setHistory,
        () =>
          setMessage(
            'Could not load transaction history.'
          )
      )

    return () => {
      stopProducts()
      stopInventory()
      stopHistory()
    }
  }, [])

  // ==========================================================
  // CURRENT INVENTORY
  // ==========================================================

  const currentInventory =
    useMemo(() => {
      return inventory
        .map((item) => {
          const product =
            products.find(
              (p) =>
                p.id ===
                item.productId
            )

          const quantity =
            Number(
              item.quantity || 0
            )

          const costValue =
            Number(
              item.costValue || 0
            )

          return {
            ...item,

            productId:
              item.productId,

            name:
              product?.name ||
              item.name ||
              'Unknown product',

            category:
              product?.category ||
              item.category ||
              '',

            imageUrl:
              product?.imageUrl ||
              item.imageUrl ||
              '',

            threshold:
              Number(
                product?.threshold ??
                  item.threshold ??
                  10
              ),

            quantity,

            costValue,

            avgCost:
              quantity > 0
                ? costValue /
                  quantity
                : 0,

            lastBuyPrice:
              Number(
                item.lastBuyPrice ||
                  item.price ||
                  0
              ),
          }
        })
        .sort((a, b) =>
          compareText(
            a.name,
            b.name
          )
        )
    }, [
      inventory,
      products,
    ])

  const inventoryByProduct =
    useMemo(() => {
      const map = new Map()

      currentInventory.forEach(
        (item) => {
          map.set(
            item.productId,
            item
          )
        }
      )

      return map
    }, [currentInventory])

  const alerts =
    currentInventory.filter(
      (item) =>
        stateOf(item) !== 'ok'
    )

  const low =
    alerts.filter(
      (item) =>
        stateOf(item) === 'low'
    )

  const out =
    alerts.filter(
      (item) =>
        stateOf(item) === 'out'
    )

  const inventoryValue =
    currentInventory.reduce(
      (total, item) =>
        total +
        Number(
          item.costValue || 0
        ),
      0
    )

  // ==========================================================
  // NAVIGATION
  // ==========================================================

  const nav = (next) => {
    setPage(next)
    setMessage('')
  }

  // ==========================================================
  // PRODUCT
  // ==========================================================

  async function saveProduct(event) {
    event.preventDefault()

    if (
      !productForm.name.trim() ||
      !productForm.category.trim() ||
      productForm.threshold === '' ||
      Number(
        productForm.threshold
      ) < 0
    ) {
      setMessage(
        'Enter product name, category and a valid low-stock threshold.'
      )
      return
    }

    if (!firebaseConfigured) {
      setMessage(
        'Add Firebase credentials before saving.'
      )
      return
    }

    setSaving(true)

    try {
      const payload = {
        name:
          productForm.name.trim(),

        category:
          productForm.category.trim(),

        threshold:
          Number(
            productForm.threshold
          ),

        imageUrl:
          productForm.imageUrl.trim(),
      }

      if (editingProduct) {
        await updateProduct(
          editingProduct,
          payload
        )

        setMessage(
          'Product updated.'
        )
      } else {
        await addProduct(
          payload
        )

        setMessage(
          'Product created. Add stock through Transactions.'
        )
      }

      setProductForm(
        blankProduct
      )

      setEditingProduct(null)
    } catch (error) {
      console.error(error)

      setMessage(
        'Unable to save product.'
      )
    } finally {
      setSaving(false)
    }
  }

  function editProduct(product) {
    setProductForm({
      name:
        product.name || '',

      category:
        product.category || '',

      threshold:
        String(
          product.threshold ??
            10
        ),

      imageUrl:
        product.imageUrl || '',
    })

    setEditingProduct(
      product.id
    )

    nav('products')
  }

  async function removeProduct(
    product
  ) {
    const stock =
      inventoryByProduct.get(
        product.id
      )

    const confirmed =
      window.confirm(
        stock?.quantity > 0
          ? `Delete "${product.name}"? It currently has ${stock.quantity} units in inventory.`
          : `Delete "${product.name}"?`
      )

    if (!confirmed) {
      return
    }

    try {
      await deleteProduct(
        product.id
      )

      setMessage(
        'Product deleted. Existing transaction history is retained.'
      )
    } catch (error) {
      console.error(error)

      setMessage(
        'Unable to delete product.'
      )
    }
  }

  // ==========================================================
  // TRANSACTION
  // ==========================================================

  async function saveTransaction(
    event
  ) {
    event.preventDefault()

    if (
      !transactionForm.productId
    ) {
      setMessage(
        'Select a product.'
      )
      return
    }

    if (
      transactionForm.quantity ===
        '' ||
      Number(
        transactionForm.quantity
      ) <= 0
    ) {
      setMessage(
        'Enter a quantity greater than zero.'
      )
      return
    }

    if (
      transactionForm.price ===
        '' ||
      Number(
        transactionForm.price
      ) < 0
    ) {
      setMessage(
        'Enter a valid price.'
      )
      return
    }

    if (
      !transactionForm.transactionDate
    ) {
      setMessage(
        'Select transaction date.'
      )
      return
    }

    if (!firebaseConfigured) {
      setMessage(
        'Add Firebase credentials before saving.'
      )
      return
    }

    const product =
      products.find(
        (item) =>
          item.id ===
          transactionForm.productId
      )

    if (!product) {
      setMessage(
        'Selected product was not found.'
      )
      return
    }

    setSaving(true)

    try {
      const result =
        await applyInventoryTransaction(
          {
            product,

            action:
              transactionForm.action,

            quantity:
              Number(
                transactionForm.quantity
              ),

            price:
              Number(
                transactionForm.price
              ),

            supplier:
              transactionForm.supplier.trim(),

            note:
              transactionForm.note.trim(),

            transactionDate:
              transactionForm.transactionDate,
          }
        )

      const action =
        transactionForm.action

      setTransactionForm({
        ...blankTransaction,
        transactionDate:
          transactionForm.transactionDate,
      })

      setMessage(
        `${action} recorded. ${product.name}: ${result.quantityAfter} units now in inventory.`
      )
    } catch (error) {
      console.error(error)

      setMessage(
        error?.message ||
          'Unable to save transaction.'
      )
    } finally {
      setSaving(false)
    }
  }

  // ==========================================================
  // SIDEBAR
  // ==========================================================

  const navigation = [
    [
      'overview',
      '▦',
      'Overview',
    ],
    [
      'products',
      '▣',
      'Products',
    ],
    [
      'inventory',
      '▤',
      'Inventory',
    ],
    [
      'transactions',
      '⇄',
      'Transactions',
    ],
    [
      'history',
      '◷',
      'Transaction History',
    ],
    [
      'profitloss',
      '₹',
      'Profit & Loss',
    ],
    [
      'alerts',
      '♟',
      'Alerts',
    ],
  ]

  return (
    <div className="layout">

      <aside className="sidebar">

        <div className="brand">
          <b>IP</b>
          <span>
            InventoryPro
          </span>
        </div>

        <div className="nav-label">
          MAIN
        </div>

        {navigation.map(
          ([
            key,
            icon,
            label,
          ]) => (
            <button
              key={key}
              className={
                page === key
                  ? 'nav active'
                  : 'nav'
              }
              onClick={() =>
                nav(key)
              }
            >
              <i>
                {icon}
              </i>

              {label}

              {key ===
                'alerts' &&
                alerts.length >
                  0 && (
                  <em>
                    {
                      alerts.length
                    }
                  </em>
                )}
            </button>
          )
        )}

        <div className="profile">
          <b>A</b>

          <span>
            Admin
            <small>
              Inventory Manager
            </small>
          </span>
        </div>

      </aside>

      <main className="content">

        {message && (
          <div className="message">
            {message}
          </div>
        )}

        {!firebaseConfigured && (
          <div className="setup-note">
            Connect Firebase in{' '}
            <code>
              .env.local
            </code>{' '}
            to save data.
          </div>
        )}

        {page ===
          'overview' && (
          <Overview
            products={
              products
            }
            inventory={
              currentInventory
            }
            inventoryValue={
              inventoryValue
            }
            alerts={
              alerts.length
            }
            go={nav}
          />
        )}

        {page ===
          'products' && (
          <Products
            products={
              products
            }
            inventoryByProduct={
              inventoryByProduct
            }
            form={
              productForm
            }
            setForm={
              setProductForm
            }
            save={
              saveProduct
            }
            editId={
              editingProduct
            }
            edit={
              editProduct
            }
            remove={
              removeProduct
            }
            saving={
              saving
            }
          />
        )}

        {page ===
          'inventory' && (
          <Inventory
            products={
              products
            }
            inventory={
              currentInventory
            }
            go={nav}
          />
        )}

        {page ===
          'transactions' && (
          <Transactions
            products={
              products
            }
            inventoryByProduct={
              inventoryByProduct
            }
            form={
              transactionForm
            }
            setForm={
              setTransactionForm
            }
            save={
              saveTransaction
            }
            saving={
              saving
            }
          />
        )}

        {page ===
          'history' && (
          <History
            history={
              history
            }
          />
        )}

        {page ===
          'profitloss' && (
          <ProfitLoss
            history={
              history
            }
          />
        )}

        {page ===
          'alerts' && (
          <Alerts
            out={out}
            low={low}
            go={nav}
          />
        )}

      </main>
    </div>
  )
}

// ============================================================
// OVERVIEW
// ============================================================

function Overview({
  products,
  inventory,
  inventoryValue,
  alerts,
  go,
}) {
  return (
    <>
      <header className="page-title">

        <div>
          <h1>
            Overview
          </h1>

          <p>
            {
              products.length
            } products ·{' '}
            {
              inventory.length
            } inventory records
          </p>
        </div>

      </header>

      <section className="metrics">

        <Metric
          label="Total Products"
          value={
            products.length
          }
          note="in your catalog"
          tone="purple"
        />

        <Metric
          label="Inventory Value"
          value={money(
            inventoryValue
          )}
          note="at purchase cost"
          tone="green"
        />

        <Metric
          label="Products In Stock"
          value={
            inventory.filter(
              (item) =>
                item.quantity >
                0
            ).length
          }
          note="currently available"
          tone="green"
        />

        <Metric
          label="Stock Alerts"
          value={alerts}
          note="need attention"
          tone="orange"
        />

      </section>

      <section className="section">

        <div className="section-top">

          <h2>
            Current Inventory
          </h2>

          <button
            className="text-button"
            onClick={() =>
              go('inventory')
            }
          >
            View inventory →
          </button>

        </div>

        <div className="product-grid">

          {inventory
            .slice(0, 6)
            .map((item) => (
              <StockCard
                key={
                  item.productId
                }
                stock={item}
              />
            ))}

          {!inventory.length && (
            <p className="empty-panel">
              Create a product
              first, then record
              a Purchase from
              Transactions.
            </p>
          )}

        </div>

      </section>
    </>
  )
}

// ============================================================
// PRODUCTS
// ============================================================

function Products({
  products,
  inventoryByProduct,
  form,
  setForm,
  save,
  editId,
  edit,
  remove,
  saving,
}) {
  /*
   * Categories come ONLY from Firestore products.
   */
  const categories =
    useMemo(
      () =>
        getCategories(
          products
        ),
      [products]
    )

  const [
    search,
    setSearch,
  ] = useState('')

  const [
    categoryFilter,
    setCategoryFilter,
  ] = useState('')

  const [
    sort,
    setSort,
  ] = useState('name-asc')

  const filtered =
    useMemo(() => {
      let rows =
        [...products]

      const query =
        search
          .trim()
          .toLowerCase()

      if (query) {
        rows =
          rows.filter(
            (product) =>
              product.name
                ?.toLowerCase()
                .includes(
                  query
                ) ||
              product.category
                ?.toLowerCase()
                .includes(
                  query
                )
          )
      }

      if (
        categoryFilter
      ) {
        rows =
          rows.filter(
            (product) =>
              product.category ===
              categoryFilter
          )
      }

      rows.sort(
        (a, b) => {
          if (
            sort ===
            'name-desc'
          ) {
            return compareText(
              b.name,
              a.name
            )
          }

          if (
            sort ===
            'category'
          ) {
            return compareText(
              a.category,
              b.category
            )
          }

          if (
            sort ===
            'threshold-high'
          ) {
            return (
              Number(
                b.threshold ||
                  0
              ) -
              Number(
                a.threshold ||
                  0
              )
            )
          }

          if (
            sort ===
            'threshold-low'
          ) {
            return (
              Number(
                a.threshold ||
                  0
              ) -
              Number(
                b.threshold ||
                  0
              )
            )
          }

          return compareText(
            a.name,
            b.name
          )
        }
      )

      return rows
    }, [
      products,
      search,
      categoryFilter,
      sort,
    ])

  const field =
    (key) =>
    (event) =>
      setForm({
        ...form,
        [key]:
          event.target.value,
      })

  const clearFilters =
    () => {
      setSearch('')
      setCategoryFilter('')
      setSort('name-asc')
    }

  return (
    <>
      <header className="page-title">

        <div>
          <h1>
            Products
          </h1>

          <p>
            {
              products.length
            } catalog products
          </p>
        </div>

      </header>

      <FilterBar
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Search product or category..."
        filters={[
          {
            value:
              categoryFilter,
            onChange:
              setCategoryFilter,
            options:
              categories,
            placeholder:
              'All categories',
          },
        ]}
        sort={sort}
        setSort={setSort}
        sortOptions={[
          [
            'name-asc',
            'Name A–Z',
          ],
          [
            'name-desc',
            'Name Z–A',
          ],
          [
            'category',
            'Category',
          ],
          [
            'threshold-high',
            'Threshold high → low',
          ],
          [
            'threshold-low',
            'Threshold low → high',
          ],
        ]}
        onClear={
          clearFilters
        }
      />

      <section className="table-card">

        <div className="table-scroll">

          <table>

            <thead>
              <tr>
                <th>
                  Product
                </th>

                <th>
                  Category
                </th>

                <th>
                  Low-stock threshold
                </th>

                <th>
                  Current stock
                </th>

                <th>
                  Image
                </th>

                <th>
                  Actions
                </th>
              </tr>
            </thead>

            <tbody>

              {filtered.map(
                (product) => {
                  const stock =
                    inventoryByProduct.get(
                      product.id
                    )

                  return (
                    <tr
                      key={
                        product.id
                      }
                    >

                      <td className="table-product">

                        <Art
                          item={
                            product
                          }
                          small
                        />

                        <div>
                          <strong>
                            {
                              product.name
                            }
                          </strong>

                          <small>
                            {
                              product.category
                            }
                          </small>
                        </div>

                      </td>

                      <td>
                        <span className="category-tag">
                          {
                            product.category
                          }
                        </span>
                      </td>

                      <td>
                        {
                          product.threshold ??
                          10
                        }
                      </td>

                      <td>
                        {
                          stock?.quantity ??
                          0
                        }
                      </td>

                      <td>
                        {product.imageUrl
                          ? 'Image added'
                          : 'No image'}
                      </td>

                      <td>

                        <button
                          className="icon-button"
                          onClick={() =>
                            edit(
                              product
                            )
                          }
                        >
                          ✎
                        </button>

                        <button
                          className="icon-button delete"
                          onClick={() =>
                            remove(
                              product
                            )
                          }
                        >
                          ♜
                        </button>

                      </td>

                    </tr>
                  )
                }
              )}

              {!filtered.length && (
                <tr>
                  <td
                    colSpan="6"
                    className="empty"
                  >
                    No products match
                    your filters.
                  </td>
                </tr>
              )}

            </tbody>

          </table>

        </div>

      </section>

      <section className="form-panel catalog-form">

        <div>

          <p className="eyebrow">
            {editId
              ? 'UPDATE PRODUCT'
              : 'NEW PRODUCT'}
          </p>

          <h2>
            {editId
              ? 'Edit product'
              : 'Add product'}
          </h2>

          <p>
            Category is free text.
            Existing categories
            from your database will
            appear as suggestions.
          </p>

        </div>

        <form onSubmit={save}>

          <label>
            Product name

            <input
              value={
                form.name
              }
              onChange={
                field('name')
              }
              placeholder="e.g. Eggs"
            />
          </label>

          <label>
            Category

            <input
              list="category-suggestions"
              value={
                form.category
              }
              onChange={
                field(
                  'category'
                )
              }
              placeholder="Enter category"
            />

            <datalist id="category-suggestions">

              {categories.map(
                (category) => (
                  <option
                    key={
                      category
                    }
                    value={
                      category
                    }
                  />
                )
              )}

            </datalist>

          </label>

          <label>
            Low-stock threshold

            <input
              type="number"
              min="0"
              step="1"
              value={
                form.threshold
              }
              onChange={
                field(
                  'threshold'
                )
              }
            />
          </label>

          <label>
            Image URL

            <input
              value={
                form.imageUrl
              }
              onChange={
                field(
                  'imageUrl'
                )
              }
              placeholder="https://example.com/product.jpg"
            />
          </label>

          <button
            className="primary-button"
            disabled={saving}
          >
            {saving
              ? 'Saving…'
              : editId
                ? 'Save Product'
                : 'Add Product'}
          </button>

        </form>

      </section>
    </>
  )
}

// ============================================================
// INVENTORY
// ============================================================

function Inventory({
  products,
  inventory,
  go,
}) {
  /*
   * Categories are derived from actual products.
   */
  const categories =
    useMemo(
      () =>
        getCategories(
          products
        ),
      [products]
    )

  const [
    search,
    setSearch,
  ] = useState('')

  const [
    categoryFilter,
    setCategoryFilter,
  ] = useState('')

  const [
    statusFilter,
    setStatusFilter,
  ] = useState('')

  const [
    sort,
    setSort,
  ] = useState('name-asc')

  const filtered =
    useMemo(() => {
      let rows =
        [...inventory]

      const query =
        search
          .trim()
          .toLowerCase()

      if (query) {
        rows =
          rows.filter(
            (item) =>
              item.name
                ?.toLowerCase()
                .includes(
                  query
                ) ||
              item.category
                ?.toLowerCase()
                .includes(
                  query
                )
          )
      }

      if (
        categoryFilter
      ) {
        rows =
          rows.filter(
            (item) =>
              item.category ===
              categoryFilter
          )
      }

      if (
        statusFilter
      ) {
        rows =
          rows.filter(
            (item) =>
              stateOf(item) ===
              statusFilter
          )
      }

      rows.sort(
        (a, b) => {
          if (
            sort ===
            'name-desc'
          ) {
            return compareText(
              b.name,
              a.name
            )
          }

          if (
            sort ===
            'quantity-high'
          ) {
            return (
              b.quantity -
              a.quantity
            )
          }

          if (
            sort ===
            'quantity-low'
          ) {
            return (
              a.quantity -
              b.quantity
            )
          }

          if (
            sort ===
            'value-high'
          ) {
            return (
              b.costValue -
              a.costValue
            )
          }

          if (
            sort ===
            'value-low'
          ) {
            return (
              a.costValue -
              b.costValue
            )
          }

          return compareText(
            a.name,
            b.name
          )
        }
      )

      return rows
    }, [
      inventory,
      search,
      categoryFilter,
      statusFilter,
      sort,
    ])

  const clearFilters =
    () => {
      setSearch('')
      setCategoryFilter('')
      setStatusFilter('')
      setSort('name-asc')
    }

  return (
    <>
      <header className="page-title">

        <div>
          <h1>
            Inventory
          </h1>

          <p>
            Current stock and
            purchase-cost
            valuation.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={() =>
            go(
              'transactions'
            )
          }
        >
          + Record Transaction
        </button>

      </header>

      <section className="metrics">

        <Metric
          label="Catalog Products"
          value={
            products.length
          }
          note="available in Products"
          tone="purple"
        />

        <Metric
          label="Inventory Units"
          value={inventory.reduce(
            (sum, item) =>
              sum +
              Number(
                item.quantity ||
                  0
              ),
            0
          )}
          note="units currently held"
          tone="green"
        />

        <Metric
          label="Inventory Value"
          value={money(
            inventory.reduce(
              (sum, item) =>
                sum +
                Number(
                  item.costValue ||
                    0
                ),
              0
            )
          )}
          note="at purchase cost"
          tone="green"
        />

      </section>

      <FilterBar
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Search product or category..."
        filters={[
          {
            value:
              categoryFilter,
            onChange:
              setCategoryFilter,
            options:
              categories,
            placeholder:
              'All categories',
          },
          {
            value:
              statusFilter,
            onChange:
              setStatusFilter,
            options: [
              [
                'ok',
                'In stock',
              ],
              [
                'low',
                'Low stock',
              ],
              [
                'out',
                'Out of stock',
              ],
            ],
            placeholder:
              'All stock status',
          },
        ]}
        sort={sort}
        setSort={setSort}
        sortOptions={[
          [
            'name-asc',
            'Name A–Z',
          ],
          [
            'name-desc',
            'Name Z–A',
          ],
          [
            'quantity-high',
            'Quantity high → low',
          ],
          [
            'quantity-low',
            'Quantity low → high',
          ],
          [
            'value-high',
            'Value high → low',
          ],
          [
            'value-low',
            'Value low → high',
          ],
        ]}
        onClear={
          clearFilters
        }
      />

      <section className="table-card">

        <div className="table-scroll">

          <table>

            <thead>
              <tr>
                <th>
                  Product
                </th>

                <th>
                  Current stock
                </th>

                <th>
                  Average buy cost
                </th>

                <th>
                  Inventory value
                </th>

                <th>
                  Last buy price
                </th>

                <th>
                  Status
                </th>
              </tr>
            </thead>

            <tbody>

              {filtered.map(
                (item) => (
                  <tr
                    key={
                      item.productId
                    }
                  >

                    <td className="table-product">

                      <Art
                        item={
                          item
                        }
                        small
                      />

                      <div>
                        <strong>
                          {
                            item.name
                          }
                        </strong>

                        <small>
                          {
                            item.category
                          }
                        </small>
                      </div>

                    </td>

                    <td>
                      {
                        item.quantity
                      }
                    </td>

                    <td>
                      {money(
                        item.avgCost
                      )}
                    </td>

                    <td>
                      {money(
                        item.costValue
                      )}
                    </td>

                    <td>
                      {money(
                        item.lastBuyPrice
                      )}
                    </td>

                    <td>
                      <Badge
                        stock={
                          item
                        }
                      />
                    </td>

                  </tr>
                )
              )}

              {!filtered.length && (
                <tr>
                  <td
                    colSpan="6"
                    className="empty"
                  >
                    No inventory matches
                    your filters.
                  </td>
                </tr>
              )}

            </tbody>

          </table>

        </div>

      </section>
    </>
  )
}

// ============================================================
// TRANSACTIONS
// ============================================================

function Transactions({
  products,
  inventoryByProduct,
  form,
  setForm,
  save,
  saving,
}) {
  const field =
    (key) =>
    (event) =>
      setForm({
        ...form,
        [key]:
          event.target.value,
      })

  const selected =
    products.find(
      (product) =>
        product.id ===
        form.productId
    )

  const stock = selected
    ? inventoryByProduct.get(
        selected.id
      )
    : null

  const priceLabel =
    form.action ===
    'Purchase'
      ? 'Buy price per unit'
      : form.action === 'Sale'
        ? 'Selling price per unit'
        : form.action === 'Return'
          ? 'Return price per unit'
          : form.action === 'Damage'
            ? 'Reference cost per unit'
            : 'Adjustment cost per unit'

  return (
    <>
      <header className="page-title">

        <div>
          <h1>
            Transactions
          </h1>

          <p>
            Every transaction
            changes Inventory
            automatically.
          </p>
        </div>

      </header>

      <section className="form-panel stock-form">

        <div>

          <p className="eyebrow">
            INVENTORY MOVEMENT
          </p>

          <h2>
            Record transaction
          </h2>

          <p>
            Do not edit Inventory
            directly. Use Purchase,
            Sale, Return, Damage
            or Adjustment.
          </p>

          {selected && (
            <div className="selected-product">

              <Art
                item={
                  selected
                }
                small
              />

              <span>

                <b>
                  {
                    selected.name
                  }
                </b>

                <small>
                  {
                    selected.category
                  }
                  {' · '}
                  Current stock:{' '}
                  {
                    stock?.quantity ??
                    0
                  }
                  {' · '}
                  Avg cost:{' '}
                  {money(
                    stock?.avgCost ??
                      0
                  )}
                </small>

              </span>

            </div>
          )}

        </div>

        <form onSubmit={save}>

          <label className="full">

            Product

            <select
              value={
                form.productId
              }
              onChange={
                field(
                  'productId'
                )
              }
            >

              <option value="">
                Choose a product
              </option>

              {products.map(
                (product) => (
                  <option
                    key={
                      product.id
                    }
                    value={
                      product.id
                    }
                  >
                    {
                      product.name
                    }
                    {' · '}
                    {
                      product.category
                    }
                  </option>
                )
              )}

            </select>

          </label>

          <label>

            Transaction type

            <select
              value={
                form.action
              }
              onChange={
                field('action')
              }
            >

              {transactionTypes.map(
                (type) => (
                  <option
                    key={type}
                    value={type}
                  >
                    {type}
                  </option>
                )
              )}

            </select>

          </label>

          <label>

            Quantity

            <input
              type="number"
              min="0.01"
              step="0.01"
              value={
                form.quantity
              }
              onChange={
                field(
                  'quantity'
                )
              }
              placeholder="100"
            />

          </label>

          <label>

            Transaction date

            <input
              type="date"
              value={
                form.transactionDate ||
                ''
              }
              onChange={
                field(
                  'transactionDate'
                )
              }
            />

          </label>

          <label>

            {priceLabel}

            <input
              type="number"
              min="0"
              step="0.01"
              value={
                form.price
              }
              onChange={
                field('price')
              }
              placeholder="5.00"
            />

          </label>

          <label>

            Supplier / Party

            <input
              value={
                form.supplier
              }
              onChange={
                field(
                  'supplier'
                )
              }
              placeholder="Optional"
            />

          </label>

          <label className="full">

            Note

            <input
              value={
                form.note
              }
              onChange={
                field('note')
              }
              placeholder="Optional note"
            />

          </label>

          <button
            className="primary-button"
            disabled={saving}
          >
            {saving
              ? 'Saving…'
              : `Record ${form.action}`}
          </button>

        </form>

      </section>
    </>
  )
}

// ============================================================
// HISTORY
// ============================================================

function History({
  history,
}) {
  /*
   * Categories are derived from transaction history/product names.
   */

  const [
    search,
    setSearch,
  ] = useState('')

  const [
    typeFilter,
    setTypeFilter,
  ] = useState('')

  const [
    productFilter,
    setProductFilter,
  ] = useState('')

  const [
    fromDate,
    setFromDate,
  ] = useState('')

  const [
    toDate,
    setToDate,
  ] = useState('')

  const [
    sort,
    setSort,
  ] = useState('newest')

  const productOptions =
    useMemo(() => {
      const map =
        new Map()

      history.forEach(
        (entry) => {
          if (
            entry.productId
          ) {
            map.set(
              entry.productId,
              entry.productName
            )
          }
        }
      )

      return [
        ...map.entries(),
      ]
    }, [history])

  const filtered =
    useMemo(() => {
      let rows =
        [...history]

      const query =
        search
          .trim()
          .toLowerCase()

      if (query) {
        rows =
          rows.filter(
            (entry) =>
              entry.productName
                ?.toLowerCase()
                .includes(
                  query
                ) ||
              entry.supplier
                ?.toLowerCase()
                .includes(
                  query
                ) ||
              entry.note
                ?.toLowerCase()
                .includes(
                  query
                )
          )
      }

      if (
        typeFilter
      ) {
        rows =
          rows.filter(
            (entry) =>
              entry.action ===
              typeFilter
          )
      }

      if (
        productFilter
      ) {
        rows =
          rows.filter(
            (entry) =>
              entry.productId ===
              productFilter
          )
      }

      if (
        fromDate ||
        toDate
      ) {
        rows =
          rows.filter(
            (entry) =>
              withinDateRange(
                entry,
                fromDate,
                toDate
              )
          )
      }

      rows.sort(
        (a, b) => {
          const aTime =
            transactionDateOf(
              a
            )?.getTime() || 0

          const bTime =
            transactionDateOf(
              b
            )?.getTime() || 0

          if (
            sort ===
            'oldest'
          ) {
            return (
              aTime - bTime
            )
          }

          if (
            sort ===
            'quantity-high'
          ) {
            return (
              Number(
                b.quantity ||
                  0
              ) -
              Number(
                a.quantity ||
                  0
              )
            )
          }

          if (
            sort ===
            'amount-high'
          ) {
            return (
              Number(
                b.transactionValue ||
                  0
              ) -
              Number(
                a.transactionValue ||
                  0
              )
            )
          }

          return (
            bTime - aTime
          )
        }
      )

      return rows
    }, [
      history,
      search,
      typeFilter,
      productFilter,
      fromDate,
      toDate,
      sort,
    ])

  const clearFilters =
    () => {
      setSearch('')
      setTypeFilter('')
      setProductFilter('')
      setFromDate('')
      setToDate('')
      setSort('newest')
    }

  return (
    <>
      <header className="page-title">

        <div>
          <h1>
            Transaction History
          </h1>

          <p>
            Audit trail of every
            inventory movement.
          </p>
        </div>

      </header>

      <FilterBar
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Search product, supplier or note..."
        filters={[
          {
            value:
              productFilter,
            onChange:
              setProductFilter,
            options:
              productOptions,
            placeholder:
              'All products',
          },
          {
            value:
              typeFilter,
            onChange:
              setTypeFilter,
            options:
              transactionTypes,
            placeholder:
              'All transaction types',
          },
        ]}
        fromDate={
          fromDate
        }
        setFromDate={
          setFromDate
        }
        toDate={
          toDate
        }
        setToDate={
          setToDate
        }
        sort={sort}
        setSort={setSort}
        sortOptions={[
          [
            'newest',
            'Newest first',
          ],
          [
            'oldest',
            'Oldest first',
          ],
          [
            'quantity-high',
            'Quantity high → low',
          ],
          [
            'amount-high',
            'Amount high → low',
          ],
        ]}
        onClear={
          clearFilters
        }
      />

      <TransactionTable
        history={
          filtered
        }
      />
    </>
  )
}

// ============================================================
// TRANSACTION TABLE
// ============================================================

function TransactionTable({
  history,
}) {
  return (
    <section className="table-card">

      <div className="table-scroll">

        <table>

          <thead>
            <tr>

              <th>
                Transaction Date
              </th>

              <th>
                Product
              </th>

              <th>
                Transaction
              </th>

              <th>
                Qty
              </th>

              <th>
                Price
              </th>

              <th>
                Revenue
              </th>

              <th>
                COGS
              </th>

              <th>
                Inventory after
              </th>

              <th>
                Supplier / Party
              </th>

            </tr>
          </thead>

          <tbody>

            {history.map(
              (entry) => (
                <tr
                  key={
                    entry.id
                  }
                >

                  <td>
                    {dateOf(
                      entry
                    )}
                  </td>

                  <td className="table-product">

                    <Art
                      item={{
                        name:
                          entry.productName,

                        imageUrl:
                          entry.productImageUrl,
                      }}
                      small
                    />

                    <div>

                      <strong>
                        {
                          entry.productName
                        }
                      </strong>

                      {entry.note && (
                        <small>
                          {
                            entry.note
                          }
                        </small>
                      )}

                    </div>

                  </td>

                  <td>

                    <span className="history-action added">
                      {
                        entry.action
                      }
                    </span>

                  </td>

                  <td>
                    {
                      entry.quantity
                    }
                  </td>

                  <td>
                    {money(
                      entry.unitPrice ??
                        entry.price
                    )}
                  </td>

                  <td>
                    {money(
                      entry.salesRevenue
                    )}
                  </td>

                  <td>
                    {money(
                      entry.cogs
                    )}
                  </td>

                  <td>
                    {
                      entry.inventoryQuantityAfter ??
                      '—'
                    }
                    {' / '}
                    {money(
                      entry.inventoryValueAfter
                    )}
                  </td>

                  <td>
                    {
                      entry.supplier ||
                      '—'
                    }
                  </td>

                </tr>
              )
            )}

            {!history.length && (
              <tr>
                <td
                  colSpan="9"
                  className="empty"
                >
                  No transactions
                  match your filters.
                </td>
              </tr>
            )}

          </tbody>

        </table>

      </div>

    </section>
  )
}

// ============================================================
// PROFIT & LOSS
// ============================================================

function ProfitLoss({
  history,
}) {
  const months =
    useMemo(() => {
      const keys =
        history
          .map(
            monthKey
          )
          .filter(Boolean)

      return [
        ...new Set(keys),
      ].sort().reverse()
    }, [history])

  const [
    selectedMonth,
    setSelectedMonth,
  ] = useState('')

  const [
    productFilter,
    setProductFilter,
  ] = useState('')

  const [
    fromDate,
    setFromDate,
  ] = useState('')

  const [
    toDate,
    setToDate,
  ] = useState('')

  const [
    sort,
    setSort,
  ] = useState(
    'date-newest'
  )

  useEffect(() => {
    if (
      !selectedMonth &&
      months.length
    ) {
      setSelectedMonth(
        months[0]
      )
    }

    if (
      selectedMonth &&
      !months.includes(
        selectedMonth
      ) &&
      months.length
    ) {
      setSelectedMonth(
        months[0]
      )
    }
  }, [
    months,
    selectedMonth,
  ])

  const productOptions =
    useMemo(() => {
      const map =
        new Map()

      history
        .filter(
          (entry) =>
            entry.action ===
            'Sale'
        )
        .forEach(
          (entry) => {
            if (
              entry.productId
            ) {
              map.set(
                entry.productId,
                entry.productName
              )
            }
          }
        )

      return [
        ...map.entries(),
      ]
    }, [history])

  const sales =
    useMemo(() => {
      let rows =
        history.filter(
          (entry) =>
            entry.action ===
            'Sale'
        )

      if (
        selectedMonth
      ) {
        rows =
          rows.filter(
            (entry) =>
              monthKey(entry) ===
              selectedMonth
          )
      }

      if (
        productFilter
      ) {
        rows =
          rows.filter(
            (entry) =>
              entry.productId ===
              productFilter
          )
      }

      if (
        fromDate ||
        toDate
      ) {
        rows =
          rows.filter(
            (entry) =>
              withinDateRange(
                entry,
                fromDate,
                toDate
              )
          )
      }

      rows.sort(
        (a, b) => {
          const aTime =
            transactionDateOf(
              a
            )?.getTime() || 0

          const bTime =
            transactionDateOf(
              b
            )?.getTime() || 0

          if (
            sort ===
            'date-oldest'
          ) {
            return (
              aTime - bTime
            )
          }

          if (
            sort ===
            'revenue-high'
          ) {
            return (
              Number(
                b.salesRevenue ??
                  b.transactionValue ??
                  0
              ) -
              Number(
                a.salesRevenue ??
                  a.transactionValue ??
                  0
              )
            )
          }

          if (
            sort ===
            'profit-high'
          ) {
            const aRevenue =
              Number(
                a.salesRevenue ??
                  a.transactionValue ??
                  0
              )

            const bRevenue =
              Number(
                b.salesRevenue ??
                  b.transactionValue ??
                  0
              )

            const aCogs =
              Number(
                a.cogs ||
                  0
              )

            const bCogs =
              Number(
                b.cogs ||
                  0
              )

            return (
              bRevenue -
              bCogs -
              (aRevenue -
                aCogs)
            )
          }

          return (
            bTime - aTime
          )
        }
      )

      return rows
    }, [
      history,
      selectedMonth,
      productFilter,
      fromDate,
      toDate,
      sort,
    ])

  const revenue =
    sales.reduce(
      (sum, entry) =>
        sum +
        Number(
          entry.salesRevenue ??
            entry.transactionValue ??
            0
        ),
      0
    )

  const cogs =
    sales.reduce(
      (sum, entry) =>
        sum +
        Number(
          entry.cogs ??
            entry.inventoryCostChange ??
            0
        ),
      0
    )

  const grossProfit =
    revenue - cogs

  const unitsSold =
    sales.reduce(
      (sum, entry) =>
        sum +
        Number(
          entry.quantity || 0
        ),
      0
    )

  const productRows =
    useMemo(() => {
      const map =
        new Map()

      sales.forEach(
        (entry) => {
          const key =
            entry.productId ||
            entry.productName

          const row =
            map.get(key) || {
              productName:
                entry.productName,

              units: 0,

              revenue: 0,

              cogs: 0,
            }

          row.units +=
            Number(
              entry.quantity ||
                0
            )

          row.revenue +=
            Number(
              entry.salesRevenue ??
                entry.transactionValue ??
                0
            )

          row.cogs +=
            Number(
              entry.cogs ??
                entry.inventoryCostChange ??
                0
            )

          map.set(
            key,
            row
          )
        }
      )

      return [
        ...map.values(),
      ]
        .map(
          (row) => ({
            ...row,

            profit:
              row.revenue -
              row.cogs,
          })
        )
        .sort(
          (a, b) =>
            b.revenue -
            a.revenue
        )
    }, [sales])

  const clearFilters =
    () => {
      setProductFilter('')
      setFromDate('')
      setToDate('')
      setSort(
        'date-newest'
      )
    }

  return (
    <>
      <header className="page-title">

        <div>
          <h1>
            Profit & Loss
          </h1>

          <p>
            Monthly sales revenue,
            COGS and gross profit.
          </p>
        </div>

      </header>

      <section className="form-panel">

        <div>

          <p className="eyebrow">
            MONTHLY VIEW
          </p>

          <h2>
            {selectedMonth
              ? monthLabel(
                  selectedMonth
                )
              : 'No sales yet'}
          </h2>

          <p>
            Use the month selector
            to review sales
            performance.
          </p>

        </div>

        <div>

          <label>

            Select month

            <select
              value={
                selectedMonth
              }
              onChange={(event) =>
                setSelectedMonth(
                  event.target.value
                )
              }
              disabled={
                !months.length
              }
            >

              {!months.length && (
                <option value="">
                  No sales months
                </option>
              )}

              {months.map(
                (month) => (
                  <option
                    key={month}
                    value={month}
                  >
                    {
                      monthLabel(
                        month
                      )
                    }
                  </option>
                )
              )}

            </select>

          </label>

        </div>

      </section>

      <section className="metrics">

        <Metric
          label="Sales Revenue"
          value={money(
            revenue
          )}
          note="selling price collected"
          tone="purple"
        />

        <Metric
          label="COGS"
          value={money(cogs)}
          note="purchase cost of sold units"
          tone="orange"
        />

        <Metric
          label="Gross Profit"
          value={money(
            grossProfit
          )}
          note="revenue − COGS"
          tone="green"
        />

        <Metric
          label="Units Sold"
          value={
            unitsSold
          }
          note="total units sold"
          tone="green"
        />

      </section>

      <FilterBar
        search=""
        setSearch={() => {}}
        hideSearch
        filters={[
          {
            value:
              productFilter,
            onChange:
              setProductFilter,
            options:
              productOptions,
            placeholder:
              'All products',
          },
        ]}
        fromDate={
          fromDate
        }
        setFromDate={
          setFromDate
        }
        toDate={
          toDate
        }
        setToDate={
          setToDate
        }
        sort={sort}
        setSort={setSort}
        sortOptions={[
          [
            'date-newest',
            'Newest first',
          ],
          [
            'date-oldest',
            'Oldest first',
          ],
          [
            'revenue-high',
            'Revenue high → low',
          ],
          [
            'profit-high',
            'Profit high → low',
          ],
        ]}
        onClear={
          clearFilters
        }
      />

      <section className="table-card">

        <div className="section-top">

          <h2>
            Product-wise P&L
          </h2>

        </div>

        <div className="table-scroll">

          <table>

            <thead>
              <tr>

                <th>
                  Product
                </th>

                <th>
                  Units sold
                </th>

                <th>
                  Revenue
                </th>

                <th>
                  COGS
                </th>

                <th>
                  Gross profit
                </th>

              </tr>
            </thead>

            <tbody>

              {productRows.map(
                (row) => (
                  <tr
                    key={
                      row.productName
                    }
                  >

                    <td>
                      {
                        row.productName
                      }
                    </td>

                    <td>
                      {
                        row.units
                      }
                    </td>

                    <td>
                      {money(
                        row.revenue
                      )}
                    </td>

                    <td>
                      {money(
                        row.cogs
                      )}
                    </td>

                    <td>
                      {money(
                        row.profit
                      )}
                    </td>

                  </tr>
                )
              )}

              {!productRows.length && (
                <tr>
                  <td
                    colSpan="5"
                    className="empty"
                  >
                    No sales for this
                    selection.
                  </td>
                </tr>
              )}

            </tbody>

          </table>

        </div>

      </section>

      <section className="table-card">

        <div className="section-top">

          <h2>
            Sales Details
          </h2>

          <span>
            {
              sales.length
            } sales
          </span>

        </div>

        <div className="table-scroll">

          <table>

            <thead>
              <tr>

                <th>
                  Date
                </th>

                <th>
                  Product
                </th>

                <th>
                  Quantity
                </th>

                <th>
                  Selling Price
                </th>

                <th>
                  Revenue
                </th>

                <th>
                  COGS
                </th>

                <th>
                  Profit
                </th>

              </tr>
            </thead>

            <tbody>

              {sales.map(
                (entry) => {
                  const rowRevenue =
                    Number(
                      entry.salesRevenue ??
                        entry.transactionValue ??
                        0
                    )

                  const rowCogs =
                    Number(
                      entry.cogs ??
                        entry.inventoryCostChange ??
                        0
                    )

                  return (
                    <tr
                      key={
                        entry.id
                      }
                    >

                      <td>
                        {dateOf(
                          entry
                        )}
                      </td>

                      <td>
                        {
                          entry.productName
                        }
                      </td>

                      <td>
                        {
                          entry.quantity
                        }
                      </td>

                      <td>
                        {money(
                          entry.unitPrice ??
                            entry.price
                        )}
                      </td>

                      <td>
                        {money(
                          rowRevenue
                        )}
                      </td>

                      <td>
                        {money(
                          rowCogs
                        )}
                      </td>

                      <td>
                        {money(
                          rowRevenue -
                            rowCogs
                        )}
                      </td>

                    </tr>
                  )
                }
              )}

              {!sales.length && (
                <tr>
                  <td
                    colSpan="7"
                    className="empty"
                  >
                    No sales for this
                    selection.
                  </td>
                </tr>
              )}

            </tbody>

          </table>

        </div>

      </section>
    </>
  )
}

// ============================================================
// ALERTS
// ============================================================

function Alerts({
  out,
  low,
  go,
}) {
  const allAlerts = [
    ...out,
    ...low,
  ]

  /*
   * Categories come from the actual alert/product data.
   */
  const categories =
    useMemo(
      () =>
        getCategories(
          allAlerts
        ),
      [allAlerts]
    )

  const [
    search,
    setSearch,
  ] = useState('')

  const [
    categoryFilter,
    setCategoryFilter,
  ] = useState('')

  const [
    statusFilter,
    setStatusFilter,
  ] = useState('')

  const [
    sort,
    setSort,
  ] = useState(
    'severity'
  )

  const filtered =
    useMemo(() => {
      let rows =
        [...allAlerts]

      const query =
        search
          .trim()
          .toLowerCase()

      if (query) {
        rows =
          rows.filter(
            (item) =>
              item.name
                ?.toLowerCase()
                .includes(
                  query
                ) ||
              item.category
                ?.toLowerCase()
                .includes(
                  query
                )
          )
      }

      if (
        categoryFilter
      ) {
        rows =
          rows.filter(
            (item) =>
              item.category ===
              categoryFilter
          )
      }

      if (
        statusFilter
      ) {
        rows =
          rows.filter(
            (item) =>
              stateOf(item) ===
              statusFilter
          )
      }

      rows.sort(
        (a, b) => {
          if (
            sort ===
            'quantity-low'
          ) {
            return (
              a.quantity -
              b.quantity
            )
          }

          if (
            sort ===
            'quantity-high'
          ) {
            return (
              b.quantity -
              a.quantity
            )
          }

          if (
            sort ===
            'value-high'
          ) {
            return (
              b.costValue -
              a.costValue
            )
          }

          if (
            sort ===
            'name'
          ) {
            return compareText(
              a.name,
              b.name
            )
          }

          return (
            (stateOf(a) ===
            'out'
              ? 0
              : 1) -
            (stateOf(b) ===
            'out'
              ? 0
              : 1)
          )
        }
      )

      return rows
    }, [
      allAlerts,
      search,
      categoryFilter,
      statusFilter,
      sort,
    ])

  const clearFilters =
    () => {
      setSearch('')
      setCategoryFilter('')
      setStatusFilter('')
      setSort('severity')
    }

  return (
    <>
      <header className="page-title">

        <div>

          <h1>
            Stock Alerts
          </h1>

          <p>
            {
              out.length
            } out of stock ·{' '}
            {
              low.length
            } low stock
          </p>

        </div>

      </header>

      <section className="metrics">

        <Metric
          label="Out of Stock"
          value={
            out.length
          }
          note="requires action"
          tone="red"
        />

        <Metric
          label="Low Stock"
          value={
            low.length
          }
          note="below threshold"
          tone="orange"
        />

        <Metric
          label="Total Alerts"
          value={
            allAlerts.length
          }
          note="products to restock"
          tone="purple"
        />

      </section>

      <FilterBar
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Search products..."
        filters={[
          {
            value:
              categoryFilter,
            onChange:
              setCategoryFilter,
            options:
              categories,
            placeholder:
              'All categories',
          },
          {
            value:
              statusFilter,
            onChange:
              setStatusFilter,
            options: [
              [
                'out',
                'Out of stock',
              ],
              [
                'low',
                'Low stock',
              ],
            ],
            placeholder:
              'All alert status',
          },
        ]}
        sort={sort}
        setSort={setSort}
        sortOptions={[
          [
            'severity',
            'Most critical first',
          ],
          [
            'quantity-low',
            'Quantity low → high',
          ],
          [
            'quantity-high',
            'Quantity high → low',
          ],
          [
            'value-high',
            'Value high → low',
          ],
          [
            'name',
            'Name A–Z',
          ],
        ]}
        onClear={
          clearFilters
        }
      />

      <section className="alert-section">

        {filtered.map(
          (item) => (
            <article
              className={`alert-card ${stateOf(
                item
              )}`}
              key={
                item.productId
              }
            >

              <Art
                item={
                  item
                }
                small
              />

              <div className="alert-name">

                <strong>
                  {
                    item.name
                  }
                </strong>

                <small>
                  {
                    item.category
                  }
                </small>

              </div>

              <div>

                <small>
                  Current qty
                </small>

                <b>
                  {
                    item.quantity
                  }
                </b>

              </div>

              <div>

                <small>
                  Threshold
                </small>

                <b>
                  {
                    item.threshold
                  }
                </b>

              </div>

              <Badge
                stock={
                  item
                }
              />

              <button
                className="outline-button"
                onClick={() =>
                  go(
                    'transactions'
                  )
                }
              >
                Purchase stock
              </button>

            </article>
          )
        )}

        {!filtered.length && (
          <p className="empty-panel">
            No alerts match your
            filters.
          </p>
        )}

      </section>
    </>
  )
}

// ============================================================
// FILTER BAR
// ============================================================

function FilterBar({
  search,
  setSearch,
  searchPlaceholder = 'Search...',
  hideSearch = false,
  filters = [],
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  sort,
  setSort,
  sortOptions = [],
  onClear,
}) {
  const hasDateFilter =
    setFromDate &&
    setToDate

  return (
    <section className="filter-bar">

      {!hideSearch && (
        <label className="filter-search">

          <span>
            🔍
          </span>

          <input
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value
              )
            }
            placeholder={
              searchPlaceholder
            }
          />

        </label>
      )}

      {filters.map(
        (
          filter,
          index
        ) => (
          <label
            className="filter-control"
            key={
              `filter-${index}`
            }
          >

            <select
              value={
                filter.value
              }
              onChange={(event) =>
                filter.onChange(
                  event.target.value
                )
              }
            >

              <option value="">
                {
                  filter.placeholder ||
                  'All'
                }
              </option>

              {filter.options.map(
                (option) => {
                  const value =
                    Array.isArray(
                      option
                    )
                      ? option[0]
                      : option

                  const label =
                    Array.isArray(
                      option
                    )
                      ? option[1]
                      : option

                  return (
                    <option
                      key={
                        value
                      }
                      value={
                        value
                      }
                    >
                      {
                        label
                      }
                    </option>
                  )
                }
              )}

            </select>

          </label>
        )
      )}

      {hasDateFilter && (
        <>
          <label className="date-filter">

            <span>
              From
            </span>

            <input
              type="date"
              value={
                fromDate
              }
              onChange={(event) =>
                setFromDate(
                  event.target.value
                )
              }
            />

          </label>

          <label className="date-filter">

            <span>
              To
            </span>

            <input
              type="date"
              value={
                toDate
              }
              onChange={(event) =>
                setToDate(
                  event.target.value
                )
              }
            />

          </label>
        </>
      )}

      {sortOptions.length >
        0 && (
        <label className="filter-control">

          <select
            value={
              sort
            }
            onChange={(event) =>
              setSort(
                event.target.value
              )
            }
          >

            {sortOptions.map(
              ([
                value,
                label,
              ]) => (
                <option
                  key={
                    value
                  }
                  value={
                    value
                  }
                >
                  Sort: {label}
                </option>
              )
            )}

          </select>

        </label>
      )}

      <button
        type="button"
        className="clear-filter"
        onClick={
          onClear
        }
      >
        Clear
      </button>

    </section>
  )
}

// ============================================================
// SHARED COMPONENTS
// ============================================================

function Metric({
  label,
  value,
  note,
  tone,
}) {
  return (
    <article
      className={`metric ${tone}`}
    >

      <span>
        {label}
      </span>

      <strong>
        {value}
      </strong>

      <small>
        {note}
      </small>

    </article>
  )
}

function Art({
  item,
  small = false,
}) {
  return (
    <span
      className={
        small
          ? 'tiny-art'
          : 'product-art'
      }
    >
      {item?.imageUrl ? (
        <img
          src={
            item.imageUrl
          }
          alt=""
        />
      ) : (
        initials(
          item?.name
        )
      )}
    </span>
  )
}

function Badge({
  stock,
}) {
  const state =
    stateOf(stock)

  return (
    <span
      className={`stock-badge ${state}`}
    >
      {state === 'out'
        ? '● Out of stock'
        : state === 'low'
          ? `● ${stock.quantity} left`
          : `● ${stock.quantity} in stock`}
    </span>
  )
}

function StockCard({
  stock,
}) {
  return (
    <article
      className={`product-card ${stateOf(
        stock
      )}`}
    >

      <Art
        item={
          stock
        }
      />

      <div className="product-info">

        <h3>
          {stock.name}
        </h3>

        <span className="category-tag">
          {
            stock.category
          }
        </span>

      </div>

      <div className="product-bottom">

        <strong>
          {money(
            stock.avgCost
          )}{' '}
          avg. cost
        </strong>

        <Badge
          stock={
            stock
          }
        />

      </div>

    </article>
  )
}

export default App