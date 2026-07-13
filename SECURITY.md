# Security Policy

Do not publish secrets, customer data, uploaded files, browser profiles, runtime logs, or local deployment data in this repository.

## Supported Version

The current supported community line is `0.1.x`.

## Reporting

For private vulnerability reports, contact the maintainers through the repository owner channel after the public repository is created. Do not open a public issue for credentials, private data exposure, or exploitable security defects.

## Baseline Practices

- Use a strong `APP_SECRET_KEY` in production-like environments.
- Replace `INIT_ADMIN_PASSWORD` before sharing any deployed instance.
- Keep `.env`, uploads, logs, `runtime/`, database volumes, and browser profiles out of git.
- Review any new dependency before adding it to the backend or frontend package manifests.

