'use client';

import { useState, useEffect } from 'react';

interface Product {
  id: string;
  code: string;
  name: string;
  description: string;
  active: boolean;
}

export default function ProductsAdmin() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({ code: '', name: '', description: '', active: true });

  useEffect(() => {
    fetchProducts();
  }, []);

  async function fetchProducts() {
    try {
      const res = await fetch('/api/ukoo/admin/products');
      const data = await res.json();
      setProducts(data.products || []);
    } catch (err) {
      console.error('Failed to fetch products:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch('/api/ukoo/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setFormData({ code: '', name: '', description: '', active: true });
        fetchProducts();
      }
    } catch (err) {
      console.error('Failed to create product:', err);
    }
  }

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Products</h1>

      <form onSubmit={handleSubmit} className="mb-8 p-4 border rounded">
        <div className="grid gap-4">
          <input
            type="text"
            placeholder="Code (e.g., ukoo)"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
            className="p-2 border rounded"
            required
          />
          <input
            type="text"
            placeholder="Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="p-2 border rounded"
            required
          />
          <textarea
            placeholder="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="p-2 border rounded"
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.active}
              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
            />
            Active
          </label>
          <button type="submit" className="p-2 bg-blue-500 text-white rounded">
            Create Product
          </button>
        </div>
      </form>

      <div className="space-y-4">
        {products.map((product) => (
          <div key={product.id} className="p-4 border rounded">
            <h3 className="font-bold">{product.name}</h3>
            <p className="text-sm text-gray-600">Code: {product.code}</p>
            <p className="text-sm">{product.description}</p>
            <p className="text-sm">{product.active ? 'Active' : 'Inactive'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
