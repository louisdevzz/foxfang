---
summary: "Automated, hardened FoxFang installation with Ansible, Tailscale VPN, and firewall isolation"
read_when:
  - You want automated server deployment with security hardening
  - You need firewall-isolated setup with VPN access
  - You're deploying to remote Debian/Ubuntu servers
title: "Ansible"
---

# Ansible Installation

Deploy FoxFang to production servers with **[foxfang-ansible](https://github.com/PotLock/foxfang-ansible)** -- an automated installer with security-first architecture.

<Info>
The [foxfang-ansible](https://github.com/PotLock/foxfang-ansible) repo is the source of truth for Ansible deployment. This page is a quick overview.
</Info>

## Prerequisites

| Requirement | Details                                                   |
| ----------- | --------------------------------------------------------- |
| **OS**      | Debian 11+ or Ubuntu 20.04+                               |
| **Access**  | Root or sudo privileges                                   |
| **Network** | Internet connection for package installation              |
| **Ansible** | 2.14+ (installed automatically by the quick-start script) |

## What You Get

- **Firewall-first security** -- UFW + Docker isolation (only SSH + Tailscale accessible)
- **Tailscale VPN** -- secure remote access without exposing services publicly
- **Docker** -- isolated sandbox containers, localhost-only bindings
- **Defense in depth** -- 4-layer security architecture
- **Systemd integration** -- auto-start on boot with hardening
- **One-command setup** -- complete deployment in minutes

## Quick Start

One-command install:

```bash
curl -fsSL https://raw.githubusercontent.com/foxfang/foxfang-ansible/main/install.sh | bash
```

## What Gets Installed

The Ansible playbook installs and configures:

1. **Tailscale** -- mesh VPN for secure remote access
2. **UFW firewall** -- SSH + Tailscale ports only
3. **Docker CE + Compose V2** -- for agent sandboxes
4. **Node.js 24 + pnpm** -- runtime dependencies (Node 22 LTS, currently `22.14+`, remains supported)
5. **FoxFang** -- host-based, not containerized
6. **Systemd service** -- auto-start with security hardening

<Note>
The gateway runs directly on the host (not in Docker), but agent sandboxes use Docker for isolation. See [Sandboxing](/gateway/sandboxing) for details.
</Note>

## Post-Install Setup

<Steps>
  <Step title="Switch to the foxfang user">
    ```bash
    sudo -i -u foxfang
    ```
  </Step>
  <Step title="Run the onboarding wizard">
    The post-install script guides you through configuring FoxFang settings.
  </Step>
  <Step title="Connect messaging providers">
    Log in to WhatsApp, Telegram, Discord, or Signal:
    ```bash
    foxfang channels login
    ```
  </Step>
  <Step title="Verify the installation">
    ```bash
    sudo systemctl status foxfang
    sudo journalctl -u foxfang -f
    ```
  </Step>
  <Step title="Connect to Tailscale">
    Join your VPN mesh for secure remote access.
  </Step>
</Steps>

### Quick Commands

```bash
# Check service status
sudo systemctl status foxfang

# View live logs
sudo journalctl -u foxfang -f

# Restart gateway
sudo systemctl restart foxfang

# Provider login (run as foxfang user)
sudo -i -u foxfang
foxfang channels login
```

## Security Architecture

The deployment uses a 4-layer defense model:

1. **Firewall (UFW)** -- only SSH (22) + Tailscale (41641/udp) exposed publicly
2. **VPN (Tailscale)** -- gateway accessible only via VPN mesh
3. **Docker isolation** -- DOCKER-USER iptables chain prevents external port exposure
4. **Systemd hardening** -- NoNewPrivileges, PrivateTmp, unprivileged user

To verify your external attack surface:

```bash
nmap -p- YOUR_SERVER_IP
```

Only port 22 (SSH) should be open. All other services (gateway, Docker) are locked down.

Docker is installed for agent sandboxes (isolated tool execution), not for running the gateway itself. See [Multi-Agent Sandbox and Tools](/tools/multi-agent-sandbox-tools) for sandbox configuration.

## Manual Installation

If you prefer manual control over the automation:

<Steps>
  <Step title="Install prerequisites">
    ```bash
    sudo apt update && sudo apt install -y ansible git
    ```
  </Step>
  <Step title="Clone the repository">
    ```bash
    git clone https://github.com/PotLock/foxfang-ansible.git
    cd foxfang-ansible
    ```
  </Step>
  <Step title="Install Ansible collections">
    ```bash
    ansible-galaxy collection install -r requirements.yml
    ```
  </Step>
  <Step title="Run the playbook">
    ```bash
    ./run-playbook.sh
    ```

    Alternatively, run directly and then manually execute the setup script afterward:
    ```bash
    ansible-playbook playbook.yml --ask-become-pass
    # Then run: /tmp/foxfang-setup.sh
    ```

  </Step>
</Steps>

## Updating

The Ansible installer sets up FoxFang for manual updates. See [Updating](/install/updating) for the standard update flow.

To re-run the Ansible playbook (for example, for configuration changes):

```bash
cd foxfang-ansible
./run-playbook.sh
```

This is idempotent and safe to run multiple times.

## Troubleshooting

<AccordionGroup>
  <Accordion title="Firewall blocks my connection">
    - Ensure you can access via Tailscale VPN first
    - SSH access (port 22) is always allowed
    - The gateway is only accessible via Tailscale by design
  </Accordion>
  <Accordion title="Service will not start">
    ```bash
    # Check logs
    sudo journalctl -u foxfang -n 100

    # Verify permissions
    sudo ls -la /opt/foxfang

    # Test manual start
    sudo -i -u foxfang
    cd ~/foxfang
    foxfang gateway run
    ```

  </Accordion>
  <Accordion title="Docker sandbox issues">
    ```bash
    # Verify Docker is running
    sudo systemctl status docker

    # Check sandbox image
    sudo docker images | grep foxfang-sandbox

    # Build sandbox image if missing
    cd /opt/foxfang/foxfang
    sudo -u foxfang ./scripts/sandbox-setup.sh
    ```

  </Accordion>
  <Accordion title="Provider login fails">
    Make sure you are running as the `foxfang` user:
    ```bash
    sudo -i -u foxfang
    foxfang channels login
    ```
  </Accordion>
</AccordionGroup>

## Advanced Configuration

For detailed security architecture and troubleshooting, see the foxfang-ansible repo:

- [Security Architecture](https://github.com/PotLock/foxfang-ansible/blob/main/docs/security.md)
- [Technical Details](https://github.com/PotLock/foxfang-ansible/blob/main/docs/architecture.md)
- [Troubleshooting Guide](https://github.com/PotLock/foxfang-ansible/blob/main/docs/troubleshooting.md)

## Related

- [foxfang-ansible](https://github.com/PotLock/foxfang-ansible) -- full deployment guide
- [Docker](/install/docker) -- containerized gateway setup
- [Sandboxing](/gateway/sandboxing) -- agent sandbox configuration
- [Multi-Agent Sandbox and Tools](/tools/multi-agent-sandbox-tools) -- per-agent isolation
