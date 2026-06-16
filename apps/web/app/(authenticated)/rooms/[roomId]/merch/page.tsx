/**
 * app/(authenticated)/rooms/[roomId]/merch/page.tsx
 *
 * Merch Store storefront — customers view and purchase merchandise from room creators.
 */

'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { apiClient } from '@/lib/api/client';

interface MerchProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  inventory: number;
  image_url: string | null;
}

interface CartItem {
  productId: string;
  quantity: number;
  product: MerchProduct;
}

export default function RoomMerchStore() {
  const params = useParams();
  const roomId = params.roomId as string;
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['room-merch', roomId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/api/rooms/${roomId}/merch`);
      return data.products as MerchProduct[];
    },
  });

  const addToCart = (product: MerchProduct) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        return prev.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: Math.min(item.quantity + 1, product.inventory) }
            : item
        );
      }
      return [...prev, { productId: product.id, quantity: 1, product }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    const product = products.find((p) => p.id === productId);
    if (product && quantity > product.inventory) return;

    setCart((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, quantity } : item
      )
    );
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  if (isLoading) {
    return <div className="p-6 text-center">Loading merch store...</div>;
  }

  if (products.length === 0) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Merch Store</h1>
        <Card className="p-12 text-center">
          <p className="text-gray-600">This creator hasn&apos;t added any merchandise yet.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Merch Store</h1>
        <Button
          onClick={() => setShowCart(!showCart)}
          className="bg-blue-600 text-white hover:bg-blue-700 relative"
        >
          🛒 Cart
          {cart.length > 0 && (
            <span className="absolute top-0 right-0 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs transform translate-x-2 -translate-y-2">
              {cart.length}
            </span>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Products */}
        <div className="lg:col-span-2">
          {showCart ? (
            // Cart View
            <div>
              <h2 className="text-2xl font-bold mb-6">Shopping Cart</h2>
              {cart.length === 0 ? (
                <Card className="p-12 text-center">
                  <p className="text-gray-600">Your cart is empty</p>
                </Card>
              ) : (
                <div className="space-y-4">
                  {cart.map((item) => (
                    <Card key={item.productId} className="p-4">
                      <div className="flex items-start gap-4">
                        {item.product.image_url && (
                          <Image
                            src={item.product.image_url}
                            alt={item.product.name}
                            width={96}
                            height={96}
                            unoptimized
                            className="w-24 h-24 object-cover rounded"
                          />
                        )}
                        <div className="flex-1">
                          <h3 className="font-semibold">{item.product.name}</h3>
                          <p className="text-gray-600">${item.product.price}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                            className="w-8 h-8 border rounded flex items-center justify-center"
                          >
                            −
                          </button>
                          <span className="w-8 text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                            className="w-8 h-8 border rounded flex items-center justify-center"
                          >
                            +
                          </button>
                          <button
                            onClick={() => removeFromCart(item.productId)}
                            className="ml-4 text-red-600 hover:text-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Products Grid
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {products.map((product) => (
                <Card key={product.id} className="p-4 hover:shadow-lg transition">
                  {product.image_url && (
                    <Image
                      src={product.image_url}
                      alt={product.name}
                      width={400}
                      height={192}
                      unoptimized
                      className="w-full h-48 object-cover rounded-lg mb-4"
                    />
                  )}
                  <h3 className="text-lg font-bold mb-2">{product.name}</h3>
                  <p className="text-sm text-gray-600 mb-4 line-clamp-2">{product.description}</p>

                  <div className="flex justify-between items-center">
                    <span className="text-2xl font-bold text-green-600">${product.price}</span>
                    <span className="text-sm text-gray-600">
                      {product.inventory > 0 ? `${product.inventory} left` : 'Out of stock'}
                    </span>
                  </div>

                  <Button
                    onClick={() => addToCart(product)}
                    disabled={product.inventory === 0}
                    className="w-full mt-4 bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400"
                  >
                    {product.inventory === 0 ? 'Out of Stock' : 'Add to Cart'}
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Cart Summary */}
        {!showCart && (
          <div className="lg:col-span-1">
            <Card className="p-6 sticky top-6">
              <h2 className="text-xl font-bold mb-4">Order Summary</h2>

              {cart.length === 0 ? (
                <p className="text-gray-600">No items in cart</p>
              ) : (
                <>
                  <div className="space-y-3 mb-6">
                    {cart.map((item) => (
                      <div key={item.productId} className="flex justify-between text-sm">
                        <span>
                          {item.product.name} × {item.quantity}
                        </span>
                        <span>${(item.product.price * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t pt-4">
                    <div className="flex justify-between text-lg font-bold mb-4">
                      <span>Total</span>
                      <span>${cartTotal.toFixed(2)}</span>
                    </div>
                    <Button className="w-full bg-green-600 text-white hover:bg-green-700">
                      Checkout
                    </Button>
                  </div>
                </>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
