<?php
/**
 * Plugin Name: Conduit Store Reverse Proxy & Production Hygiene
 * Description: Enables X-Forwarded-Proto trust for SSL in Kubernetes, ensures REST Basic Auth compatibility, and locks down code editing.
 * Version: 1.0.0
 * Author: Conduit Platform
 */

// If behind a reverse proxy (e.g. Traefik or in-cluster ingress) sending X-Forwarded-Proto: https, tell WP we are on HTTPS
if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && 'https' === strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'])) {
    $_SERVER['HTTPS'] = 'on';
}

// Ensure Authorization header is passed to PHP environment if Apache stripped it
if (!isset($_SERVER['PHP_AUTH_USER']) && isset($_SERVER['HTTP_AUTHORIZATION'])) {
    if (0 === stripos($_SERVER['HTTP_AUTHORIZATION'], 'basic ')) {
        $exploded = explode(':', base64_decode(substr($_SERVER['HTTP_AUTHORIZATION'], 6)), 2);
        if (2 === count($exploded)) {
            $_SERVER['PHP_AUTH_USER'] = $exploded[0];
            $_SERVER['PHP_AUTH_PW']   = $exploded[1];
        }
    }
}

// Production security hardening
if (!defined('DISALLOW_FILE_EDIT')) {
    define('DISALLOW_FILE_EDIT', true);
}
