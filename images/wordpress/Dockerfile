FROM wordpress:6.7.2-apache

# Install dependencies required by WP-CLI and image management
RUN apt-get update && apt-get install -y --no-install-recommends \
    unzip \
    default-mysql-client \
    less \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install WP-CLI
RUN curl -fsSL https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar -o /usr/local/bin/wp \
    && chmod +x /usr/local/bin/wp

# Download and bake in WooCommerce 9.6.2
ARG WOOCOMMERCE_VERSION=9.6.2
RUN curl -fsSL "https://github.com/woocommerce/woocommerce/releases/download/${WOOCOMMERCE_VERSION}/woocommerce.zip" -o /tmp/woocommerce.zip \
    && mkdir -p /usr/src/wordpress/wp-content/plugins \
    && unzip -q /tmp/woocommerce.zip -d /usr/src/wordpress/wp-content/plugins \
    && rm /tmp/woocommerce.zip

# Copy mu-plugins to both image source and live directory
RUN mkdir -p /usr/src/wordpress/wp-content/mu-plugins /var/www/html/wp-content/mu-plugins
COPY mu-plugins/00-conduit-store.php /usr/src/wordpress/wp-content/mu-plugins/00-conduit-store.php
COPY mu-plugins/00-conduit-store.php /var/www/html/wp-content/mu-plugins/00-conduit-store.php

# Enable apache modules
RUN a2enmod headers rewrite

# Set correct permissions
RUN chown -R www-data:www-data /usr/src/wordpress/wp-content /var/www/html/wp-content
