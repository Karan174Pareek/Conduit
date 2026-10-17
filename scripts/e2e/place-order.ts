import { execSync } from 'node:child_process';

export function placeTestOrder(): number | undefined {
  console.log('==> Creating live WooCommerce order in store-default namespace...');
  try {
    const output = execSync(
      `kubectl exec -n store-default deployment/store-woocommerce-store-wordpress -c wordpress -- wp wc shop_order create --user=admin --status=processing --billing='{"first_name":"Karan","last_name":"Pareek","email":"karan@conduit.localhost"}' --line_items='[{"product_id":1,"quantity":2}]' --allow-root`,
      { encoding: 'utf-8' },
    );
    console.log(output.trim());
    const match = output.match(/Created shop_order (\d+)/);
    const orderId = match ? parseInt(match[1], 10) : undefined;
    console.log(`Successfully placed live test order ID: ${orderId}`);
    return orderId;
  } catch (err: any) {
    console.error('Failed to create order via WP-CLI:', err.message);
    throw err;
  }
}

// Allow direct CLI execution
if (process.argv[1]?.endsWith('place-order.ts') || process.argv[1]?.endsWith('place-order.js')) {
  placeTestOrder();
}
