/**
 * app/(authenticated)/creator/merch/page.tsx
 *
 * Creator Merch Store manager — add/edit/delete merchandise products.
 */

'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/hooks';

interface MerchProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  inventory: number;
  image_url: string | null;
  created_at: string;
}

interface CreateProductForm {
  name: string;
  description: string;
  price: string;
  inventory: string;
  imageUrl: string;
}

export default function MerchStoreManager() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<CreateProductForm>({
    name: '',
    description: '',
    price: '',
    inventory: '',
    imageUrl: '',
  });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['merch-products', user?.id],
    queryFn: async () => {
      const { data } = await apiClient.get('/api/creator/merch');
      return data.products as MerchProduct[];
    },
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateProductForm) => {
      await apiClient.post('/api/creator/merch', {
        name: data.name,
        description: data.description,
        price: parseFloat(data.price),
        inventory: parseInt(data.inventory, 10),
        imageUrl: data.imageUrl,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merch-products', user?.id] });
      setFormData({ name: '', description: '', price: '', inventory: '', imageUrl: '' });
      setShowForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (productId: string) => {
      await apiClient.delete(`/api/creator/merch/${productId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merch-products', user?.id] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.price || !formData.inventory) {
      alert('Please fill in all required fields');
      return;
    }
    createMutation.mutate(formData);
  };

  if (!user) {
    return <div className="p-6 text-center">Please sign in</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Merch Store</h1>
        <Button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : '+ Add Product'}
        </Button>
      </div>

      {/* Add Product Form */}
      {showForm && (
        <Card className="p-6 mb-8">
          <h2 className="text-2xl font-bold mb-6">Add New Product</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">Product Name *</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                placeholder="e.g., Limited Edition T-Shirt"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                placeholder="Describe your product..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Price ($) *</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Inventory *</label>
                <input
                  type="number"
                  required
                  value={formData.inventory}
                  onChange={(e) => setFormData({ ...formData, inventory: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Image URL</label>
                <input
                  type="url"
                  value={formData.imageUrl}
                  onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  placeholder="https://..."
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={createMutation.isPending}
              className="w-full bg-green-600 text-white hover:bg-green-700"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Product'}
            </Button>
          </form>
        </Card>
      )}

      {/* Products List */}
      {isLoading ? (
        <div className="text-center">Loading products...</div>
      ) : products.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-gray-600 mb-6">No products yet. Start selling by adding your first item!</p>
          <Button
            onClick={() => setShowForm(true)}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            Add Your First Product
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((product) => (
            <Card key={product.id} className="p-4 hover:shadow-lg transition">
              {product.image_url && (
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="w-full h-48 object-cover rounded-lg mb-4"
                />
              )}
              <h3 className="text-lg font-bold mb-2">{product.name}</h3>
              <p className="text-sm text-gray-600 mb-4 line-clamp-2">{product.description}</p>

              <div className="flex justify-between items-center mb-4">
                <span className="text-2xl font-bold text-green-600">${product.price}</span>
                <span className="text-sm text-gray-600">{product.inventory} in stock</span>
              </div>

              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1">
                  Edit
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={() => {
                    if (confirm('Delete this product?')) {
                      deleteMutation.mutate(product.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
