# /// script
# dependencies = [
#     "PyQt6",
#     "requests"
# ]
# ///

import sys
import os

# Use the default backend for the active compositor (Wayland or X11)


import json
import requests
import subprocess
from PyQt6.QtWidgets import (QApplication, QWidget, QVBoxLayout, QHBoxLayout,
                                QLabel, QMenu, QDialog, QFormLayout, QLineEdit,
                                QSpinBox, QCheckBox, QPushButton, QListWidget,
                                QListWidgetItem, QComboBox, QMessageBox, QFrame,
                                QDoubleSpinBox, QScrollArea, QGridLayout)
from PyQt6.QtCore import Qt, QTimer, QPoint, QThread, pyqtSignal, QEvent
from PyQt6.QtGui import QMouseEvent, QFont, QCursor, QColor, QAction

# Configuration File Path
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

# Helper to send native desktop notifications (macOS and Linux)
def send_notification(title, message):
    if sys.platform == "darwin":
        # macOS AppleScript notification
        applescript = f'display notification "{message}" with title "{title}"'
        try:
            subprocess.run(["osascript", "-e", applescript], check=False)
        except Exception as e:
            print(f"Error sending macOS notification: {e}")
    elif sys.platform.startswith("linux"):
        # Linux notify-send
        try:
            subprocess.run(["notify-send", title, message], check=False)
        except FileNotFoundError:
            print(f"[{title}] {message} (notify-send not installed)")
        except Exception as e:
            print(f"Error sending Linux notification: {e}")
    else:
        # Fallback console log
        print(f"NOTIFICATION: [{title}] {message}")

# Helper to send Google Chat notifications (via Workspace Webhook)
def send_google_chat_notification(webhook_url, title, message):
    if not webhook_url:
        return
    import threading
    payload = {
        "text": f"🔔 *{title}*\n{message}"
    }
    def post_to_webhook():
        try:
            requests.post(webhook_url, json=payload, timeout=5)
        except Exception as e:
            print(f"Error posting to Google Chat: {e}")
    threading.Thread(target=post_to_webhook, daemon=True).start()

# Helper to send Telegram notifications (via Bot API)
def send_telegram_notification(bot_token, chat_id, message):
    if not bot_token or not chat_id:
        return
    import threading
    payload = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "Markdown"
    }
    def post_to_telegram():
        try:
            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            requests.post(url, json=payload, timeout=5)
        except Exception as e:
            print(f"Error posting to Telegram: {e}")
    threading.Thread(target=post_to_telegram, daemon=True).start()

# Background Worker Thread for API Fetching
class FetchWorker(QThread):
    finished = pyqtSignal(dict, str)

    def run(self):
        try:
            response = requests.get("https://stocknow.com.bd/api/v1/instruments", timeout=8)
            if response.status_code == 200:
                self.finished.emit(response.json(), "")
            else:
                self.finished.emit({}, f"HTTP Error {response.status_code}")
        except Exception as e:
            self.finished.emit({}, str(e))

# Background Worker Thread for Telegram Connection Testing
class TelegramTestWorker(QThread):
    finished = pyqtSignal(bool, str)

    def __init__(self, bot_token, chat_id, message):
        super().__init__()
        self.bot_token = bot_token
        self.chat_id = chat_id
        self.message = message

    def run(self):
        try:
            url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
            payload = {
                "chat_id": self.chat_id,
                "text": self.message,
                "parse_mode": "Markdown"
            }
            response = requests.post(url, json=payload, timeout=5)
            if response.status_code == 200:
                self.finished.emit(True, "")
            else:
                err_text = response.text
                err_msg = "API Error"
                try:
                    err_json = response.json()
                    err_msg = err_json.get("description", err_msg)
                except Exception:
                    pass
                self.finished.emit(False, f"Error {response.status_code}: {err_msg}")
        except Exception as e:
            self.finished.emit(False, str(e))

# Settings and Alerts Management Dialog
class SettingsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.parent = parent
        self.setWindowTitle("Widget Settings & Alerts")
        self.setMinimumWidth(380)
        self.setStyleSheet("""
            QDialog {
                background-color: #0f172a;
                color: #f8fafc;
            }
            QLabel {
                color: #94a3b8;
                font-size: 11px;
                font-weight: bold;
            }
            QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox {
                background-color: #1e293b;
                border: 1px solid #334155;
                border-radius: 6px;
                color: #f8fafc;
                padding: 6px;
                font-size: 12px;
            }
            QPushButton {
                background-color: #2563eb;
                border: none;
                border-radius: 6px;
                color: white;
                padding: 6px 12px;
                font-weight: bold;
                font-size: 12px;
            }
            QPushButton:hover {
                background-color: #1d4ed8;
            }
            QListWidget {
                background-color: #1e293b;
                border: 1px solid #334155;
                border-radius: 6px;
                color: #f8fafc;
            }
        """)

        # Main Layout
        layout = QVBoxLayout()
        self.setLayout(layout)

        # Watchlist section
        layout.addWidget(QLabel("MANAGE WATCHLIST"))
        wl_layout = QHBoxLayout()
        self.wl_input = QLineEdit()
        self.wl_input.setPlaceholderText("Enter stock symbol (e.g. GP)")
        self.wl_add_btn = QPushButton("Add")
        self.wl_add_btn.clicked.connect(self.add_to_watchlist)
        wl_layout.addWidget(self.wl_input)
        wl_layout.addWidget(self.wl_add_btn)
        layout.addLayout(wl_layout)

        self.wl_list = QListWidget()
        layout.addWidget(self.wl_list)
        
        self.wl_remove_btn = QPushButton("Remove Selected Stock")
        self.wl_remove_btn.setStyleSheet("background-color: #ef4444;")
        self.wl_remove_btn.clicked.connect(self.remove_from_watchlist)
        layout.addWidget(self.wl_remove_btn)

        # Space
        layout.addWidget(QFrame())

        # Alerts section
        layout.addWidget(QLabel("PRICE ALERTS"))
        alert_add_layout = QHBoxLayout()
        
        self.alert_symbol_cb = QComboBox()
        self.alert_cond_cb = QComboBox()
        self.alert_cond_cb.addItems(["above", "below"])
        self.alert_val_sb = QDoubleSpinBox()
        self.alert_val_sb.setRange(0.0, 10000.0)
        self.alert_val_sb.setSingleStep(1.0)
        
        self.alert_add_btn = QPushButton("Add Alert")
        self.alert_add_btn.clicked.connect(self.add_alert)
        
        alert_add_layout.addWidget(self.alert_symbol_cb)
        alert_add_layout.addWidget(self.alert_cond_cb)
        alert_add_layout.addWidget(self.alert_val_sb)
        alert_add_layout.addWidget(self.alert_add_btn)
        layout.addLayout(alert_add_layout)

        self.alerts_list = QListWidget()
        layout.addWidget(self.alerts_list)

        self.alert_remove_btn = QPushButton("Remove Selected Alert")
        self.alert_remove_btn.setStyleSheet("background-color: #ef4444;")
        self.alert_remove_btn.clicked.connect(self.remove_alert)
        layout.addWidget(self.alert_remove_btn)

        # Options section
        layout.addWidget(QFrame())
        form_layout = QFormLayout()
        
        self.spin_refresh = QSpinBox()
        self.spin_refresh.setRange(1, 60)
        self.spin_refresh.setSuffix(" min")
        form_layout.addRow(QLabel("Refresh Interval:"), self.spin_refresh)
        
        self.chk_ontop = QCheckBox()
        form_layout.addRow(QLabel("Always on Top:"), self.chk_ontop)

        self.chk_gchat = QCheckBox()
        form_layout.addRow(QLabel("Enable Google Chat Alerts:"), self.chk_gchat)

        self.txt_gchat_url = QLineEdit()
        self.txt_gchat_url.setPlaceholderText("Paste Google Chat Webhook URL")
        form_layout.addRow(QLabel("Google Chat Webhook:"), self.txt_gchat_url)

        self.chk_telegram = QCheckBox()
        form_layout.addRow(QLabel("Enable Telegram Alerts:"), self.chk_telegram)

        self.txt_telegram_token = QLineEdit()
        self.txt_telegram_token.setPlaceholderText("Telegram Bot Token")
        form_layout.addRow(QLabel("Telegram Bot Token:"), self.txt_telegram_token)

        self.txt_telegram_chatid = QLineEdit()
        self.txt_telegram_chatid.setPlaceholderText("Telegram Chat ID (e.g. 123456789)")
        form_layout.addRow(QLabel("Telegram Chat ID:"), self.txt_telegram_chatid)

        lbl_telegram_tip = QLabel("Tip: Get your numerical ID from @userinfobot.\nYou must also send /start to your custom bot.")
        lbl_telegram_tip.setStyleSheet("color: #64748b; font-size: 10px; font-weight: normal; margin-top: -2px; margin-bottom: 4px;")
        form_layout.addRow(QLabel(""), lbl_telegram_tip)

        self.btn_test_telegram = QPushButton("Test Telegram Connection")
        self.btn_test_telegram.setStyleSheet("background-color: #1e293b; border: 1px solid #334155; color: #94a3b8;")
        self.btn_test_telegram.clicked.connect(self.test_telegram)
        form_layout.addRow(QLabel(""), self.btn_test_telegram)
        
        layout.addLayout(form_layout)

        # Footer Actions
        footer_layout = QHBoxLayout()
        btn_cancel = QPushButton("Cancel")
        btn_cancel.setStyleSheet("background-color: transparent; border: 1px solid #334155; color: #94a3b8;")
        btn_cancel.clicked.connect(self.reject)
        btn_save = QPushButton("Save Settings")
        btn_save.clicked.connect(self.save_settings)
        
        footer_layout.addStretch()
        footer_layout.addWidget(btn_cancel)
        footer_layout.addWidget(btn_save)
        layout.addLayout(footer_layout)

        # Load Current state
        self.load_current_data()

    def load_current_data(self):
        # Watchlist
        self.wl_list.clear()
        self.wl_list.addItems(self.parent.config["watchlist"])
        
        # Populate alerts dropdown
        self.alert_symbol_cb.clear()
        if self.parent.config["watchlist"]:
            self.alert_symbol_cb.addItems(self.parent.config["watchlist"])
        else:
            self.alert_symbol_cb.addItems(list(self.parent.instruments.keys())[:20])

        # Alerts list
        self.render_alerts()

        # Options
        self.spin_refresh.setValue(self.parent.config.get("refresh_interval_minutes", 5))
        self.chk_ontop.setChecked(self.parent.config.get("always_on_top", True))
        self.chk_gchat.setChecked(self.parent.config.get("enable_google_chat", False))
        self.txt_gchat_url.setText(self.parent.config.get("google_chat_webhook_url", ""))
        self.chk_telegram.setChecked(self.parent.config.get("enable_telegram", False))
        self.txt_telegram_token.setText(self.parent.config.get("telegram_bot_token", ""))
        self.txt_telegram_chatid.setText(self.parent.config.get("telegram_chat_id", ""))

    def render_alerts(self):
        self.alerts_list.clear()
        for idx, alert in enumerate(self.parent.config.get("alerts", [])):
            status = "Triggered" if alert.get("triggered", False) else "Armed"
            item_text = f"{alert['symbol']} {alert['condition']} {alert['value']} ({status})"
            item = QListWidgetItem(item_text)
            item.setData(Qt.ItemDataRole.UserRole, idx)
            self.alerts_list.addItem(item)

    def add_to_watchlist(self):
        symbol = self.wl_input.text().strip().upper()
        if not symbol:
            return
        
        # Check if already exists in list
        items = [self.wl_list.item(i).text() for i in range(self.wl_list.count())]
        if symbol in items:
            return

        self.wl_list.addItem(symbol)
        self.wl_input.clear()
        
        # Update alert dropdown
        self.alert_symbol_cb.clear()
        new_items = [self.wl_list.item(i).text() for i in range(self.wl_list.count())]
        self.alert_symbol_cb.addItems(new_items)

    def remove_from_watchlist(self):
        selected = self.wl_list.currentItem()
        if selected:
            self.wl_list.takeItem(self.wl_list.row(selected))
            # Update alert dropdown
            self.alert_symbol_cb.clear()
            new_items = [self.wl_list.item(i).text() for i in range(self.wl_list.count())]
            self.alert_symbol_cb.addItems(new_items)

    def add_alert(self):
        symbol = self.alert_symbol_cb.currentText()
        cond = self.alert_cond_cb.currentText()
        val = self.alert_val_sb.value()
        
        if not symbol:
            return
            
        # Add to local config
        if "alerts" not in self.parent.config:
            self.parent.config["alerts"] = []
            
        self.parent.config["alerts"].append({
            "symbol": symbol,
            "condition": cond,
            "value": val,
            "triggered": False
        })
        self.render_alerts()

    def remove_alert(self):
        selected = self.alerts_list.currentItem()
        if selected:
            idx = selected.data(Qt.ItemDataRole.UserRole)
            if 0 <= idx < len(self.parent.config.get("alerts", [])):
                self.parent.config["alerts"].pop(idx)
                self.render_alerts()

    def save_settings(self):
        # Read from GUI
        watchlist = [self.wl_list.item(i).text() for i in range(self.wl_list.count())]
        refresh = self.spin_refresh.value()
        ontop = self.chk_ontop.isChecked()

        # Update parent config
        self.parent.config["watchlist"] = watchlist
        self.parent.config["refresh_interval_minutes"] = refresh
        self.parent.config["always_on_top"] = ontop
        self.parent.config["enable_google_chat"] = self.chk_gchat.isChecked()
        self.parent.config["google_chat_webhook_url"] = self.txt_gchat_url.text().strip()
        self.parent.config["enable_telegram"] = self.chk_telegram.isChecked()
        self.parent.config["telegram_bot_token"] = self.txt_telegram_token.text().strip()
        self.parent.config["telegram_chat_id"] = self.txt_telegram_chatid.text().strip()
        
        self.accept()

    def test_telegram(self):
        bot_token = self.txt_telegram_token.text().strip()
        chat_id = self.txt_telegram_chatid.text().strip()
        if not bot_token or not chat_id:
            QMessageBox.warning(self, "Missing Credentials", "Please enter both Bot Token and Chat ID to test connection.")
            return
            
        self.btn_test_telegram.setEnabled(False)
        self.btn_test_telegram.setText("Testing Connection...")

        self.test_worker = TelegramTestWorker(
            bot_token,
            chat_id,
            "🔔 *StockNow Connection Test*\n\nYour Telegram bot is configured correctly and alert notifications are working!"
        )
        self.test_worker.finished.connect(self.on_telegram_test_finished)
        self.test_worker.start()

    def on_telegram_test_finished(self, success, error_msg):
        self.btn_test_telegram.setEnabled(True)
        self.btn_test_telegram.setText("Test Telegram Connection")
        
        if success:
            QMessageBox.information(
                self, 
                "Success", 
                "Connection test succeeded! Check your Telegram chat."
            )
        else:
            QMessageBox.critical(
                self, 
                "Connection Failed", 
                f"Telegram connection test failed.\n\nDetails: {error_msg}\n\n"
                "Please verify:\n"
                "1. The Bot Token is correct.\n"
                "2. The Chat ID is your numerical ID (from @userinfobot).\n"
                "3. You have started a chat with the bot on Telegram (sent /start)."
            )



# Collapsible Stock Ticker Row Widget (Click to Expand details)
class StockRowWidget(QFrame):
    def __init__(self, symbol, details, parent=None):
        super().__init__(parent)
        self.symbol = symbol
        self.details = details
        self.is_expanded = False

        self.setStyleSheet("""
            StockRowWidget {
                border-bottom: 1px solid rgba(255, 255, 255, 0.03);
            }
            StockRowWidget:hover {
                background-color: rgba(255, 255, 255, 0.02);
            }
        """)

        # Main Layout
        self.main_layout = QVBoxLayout()
        self.main_layout.setContentsMargins(4, 6, 4, 6)
        self.main_layout.setSpacing(4)
        self.setLayout(self.main_layout)

        # Header Row
        self.summary_widget = QWidget()
        summary_layout = QHBoxLayout()
        summary_layout.setContentsMargins(0, 0, 0, 0)
        self.summary_widget.setLayout(summary_layout)
        self.main_layout.addWidget(self.summary_widget)

        lbl_symbol = QLabel(symbol)
        lbl_symbol.setStyleSheet("font-weight: bold; font-size: 14px; color: white;")
        summary_layout.addWidget(lbl_symbol)

        summary_layout.addStretch()

        if details:
            price = float(details.get("close", 0.0))
            ycp = float(details.get("ycp", 0.0))
            change = price - ycp
            change_pct = (change / ycp * 100) if ycp else 0.0
            sign = "+" if change > 0 else ""
            
            lbl_price = QLabel(f"{price:.2f}")
            lbl_price.setStyleSheet("font-weight: bold; font-size: 14px; color: white;")
            summary_layout.addWidget(lbl_price)

            lbl_change = QLabel(f"{sign}{change_pct:.2f}%")
            if change > 0:
                lbl_change.setStyleSheet("""
                    background-color: rgba(16, 185, 129, 0.15);
                    color: #10b981;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: bold;
                """)
            elif change < 0:
                lbl_change.setStyleSheet("""
                    background-color: rgba(239, 68, 68, 0.15);
                    color: #ef4444;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: bold;
                """)
            else:
                lbl_change.setStyleSheet("""
                    background-color: rgba(255, 255, 255, 0.08);
                    color: #94a3b8;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: bold;
                """)
            summary_layout.addWidget(lbl_change)
        else:
            lbl_err = QLabel("Pending...")
            lbl_err.setStyleSheet("color: #6b7280; font-size: 12px;")
            summary_layout.addWidget(lbl_err)

        # Expandable Details Grid
        self.details_widget = QFrame()
        self.details_widget.setStyleSheet("""
            QFrame {
                background-color: rgba(0, 0, 0, 0.22);
                border-radius: 8px;
                padding: 6px;
            }
            QLabel {
                font-family: 'Plus Jakarta Sans', Arial;
            }
        """)
        self.details_layout = QGridLayout()
        self.details_layout.setContentsMargins(6, 6, 6, 6)
        self.details_layout.setSpacing(8)
        self.details_widget.setLayout(self.details_layout)
        self.main_layout.addWidget(self.details_widget)
        self.details_widget.setVisible(False)

        # Add stats if details exist
        if details:
            open_p = float(details.get("open", 0.0))
            high = float(details.get("high", 0.0))
            low = float(details.get("low", 0.0))
            ycp_p = float(details.get("ycp", 0.0))
            raw_vol = int(details.get("volume", 0))
            
            vol = f"{raw_vol:,}"
            if raw_vol >= 1000000:
                vol = f"{raw_vol/1000000:.2f}M"
            elif raw_vol >= 1000:
                vol = f"{raw_vol/1000:.1f}K"

            self.add_grid_item("Open", f"{open_p:.2f}", 0, 0)
            self.add_grid_item("High", f"{high:.2f}", 0, 1)
            self.add_grid_item("Low", f"{low:.2f}", 1, 0)
            self.add_grid_item("YCP", f"{ycp_p:.2f}", 1, 1)
            self.add_grid_item("Volume", vol, 2, 0, colspan=2)

    def add_grid_item(self, label, value, row, col, colspan=1):
        item_layout = QVBoxLayout()
        item_layout.setSpacing(1)
        
        lbl = QLabel(label)
        lbl.setStyleSheet("color: #6b7280; font-size: 9px; font-weight: bold; text-transform: uppercase;")
        val = QLabel(value)
        val.setStyleSheet("color: #f1f5f9; font-size: 12px; font-weight: bold;")
        
        item_layout.addWidget(lbl)
        item_layout.addWidget(val)
        
        self.details_layout.addLayout(item_layout, row, col, 1, colspan)

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            event.accept()

    def mouseReleaseEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.toggle_expanded()
            event.accept()

    def toggle_expanded(self):
        self.is_expanded = not self.is_expanded
        self.details_widget.setVisible(self.is_expanded)
        # Adjust parent widget size to wrap contents perfectly in the next tick
        QTimer.singleShot(0, self.window().adjustSize)

# Main Desktop Sticky Widget
class StickyWidget(QWidget):
    def __init__(self):
        super().__init__()
        self.config = {
            "watchlist": ["GP", "BATBC"],
            "refresh_interval_minutes": 5,
            "always_on_top": True,
            "position": [100, 100],
            "alerts": []
        }
        self.instruments = {}
        self.drag_start_pos = QPoint()
        self.window_start_pos = QPoint()
        self.dragged = False

        # Debounce timer for saving configuration/coordinates
        self.save_timer = QTimer(self)
        self.save_timer.setSingleShot(True)
        self.save_timer.timeout.connect(self.save_config)

        self.load_config()
        self.init_ui()
        self.fetch_data()

    def load_config(self):
        if os.path.exists(CONFIG_PATH):
            try:
                with open(CONFIG_PATH, "r") as f:
                    self.config = json.load(f)
            except Exception as e:
                print("Error loading config.json:", e)

    def save_config(self):
        try:
            with open(CONFIG_PATH, "w") as f:
                json.dump(self.config, f, indent=2)
        except Exception as e:
            print("Error saving config.json:", e)

    def moveEvent(self, event):
        super().moveEvent(event)
        # Update current coordinates in memory
        self.config["position"] = [self.x(), self.y()]
        # Debounce writing to config.json
        self.save_timer.start(1000)

    def init_ui(self):
        # Frameless Window, Stay on Top, Hide in Taskbar (Tool)
        flags = Qt.WindowType.FramelessWindowHint | Qt.WindowType.Tool
        if self.config.get("always_on_top", True):
            flags |= Qt.WindowType.WindowStaysOnTopHint
        self.setWindowFlags(flags)
        
        # Transparent background for rounded card effect
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setMinimumWidth(300)

        # Restore window position
        pos = self.config.get("position", [100, 100])
        self.move(pos[0], pos[1])

        # Main Layout
        self.main_layout = QVBoxLayout()
        self.main_layout.setContentsMargins(0, 0, 0, 0)
        self.setLayout(self.main_layout)

        # Card container
        self.card = QFrame()
        self.card.setObjectName("mainCard")
        self.card.setStyleSheet("""
            #mainCard {
                background-color: rgba(15, 23, 42, 0.92);
                border: 1px solid rgba(59, 130, 246, 0.18);
                border-radius: 14px;
            }
            QLabel {
                font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
                color: #f9fafb;
            }
        """)
        self.card.installEventFilter(self)
        
        self.card_layout = QVBoxLayout()
        self.card_layout.setContentsMargins(12, 12, 12, 12)
        self.card_layout.setSpacing(8)
        self.card.setLayout(self.card_layout)
        self.main_layout.addWidget(self.card)

        # Header Row
        header_layout = QHBoxLayout()
        self.lbl_title = QLabel("StockNow Widget")
        self.lbl_title.setStyleSheet("font-weight: 800; font-size: 12px; color: #94a3b8; letter-spacing: 0.5px;")
        self.lbl_title.installEventFilter(self)
        
        self.lbl_status = QLabel("●")
        self.lbl_status.setStyleSheet("color: #10b981; font-size: 14px;") # Green status dot
        self.lbl_status.installEventFilter(self)

        # Settings gear button
        self.btn_settings = QPushButton("⚙")
        self.btn_settings.setFixedSize(20, 20)
        self.btn_settings.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_settings.setStyleSheet("""
            QPushButton {
                background: transparent;
                border: none;
                color: #94a3b8;
                font-size: 14px;
                font-weight: bold;
                padding: 0;
            }
            QPushButton:hover {
                color: #f1f5f9;
            }
        """)
        self.btn_settings.clicked.connect(self.open_settings)

        # Close button
        self.btn_close = QPushButton("✕")
        self.btn_close.setFixedSize(20, 20)
        self.btn_close.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_close.setStyleSheet("""
            QPushButton {
                background: transparent;
                border: none;
                color: #64748b;
                font-size: 12px;
                font-weight: bold;
                padding: 0;
            }
            QPushButton:hover {
                color: #ef4444;
            }
        """)
        self.btn_close.clicked.connect(self.close)
        
        header_layout.addWidget(self.lbl_title)
        header_layout.addStretch()
        header_layout.addWidget(self.lbl_status)
        header_layout.addWidget(self.btn_settings)
        header_layout.addWidget(self.btn_close)
        self.card_layout.addLayout(header_layout)

        # Line Divider
        line = QFrame()
        line.setFrameShape(QFrame.Shape.HLine)
        line.setStyleSheet("background-color: rgba(255, 255, 255, 0.05); max-height: 1px; border: none;")
        self.card_layout.addWidget(line)

        # Watchlist Rows Container Widget (eliminates scrollbar to fix width and support expansion)
        self.rows_widget = QWidget()
        self.rows_widget.setStyleSheet("background: transparent;")
        self.rows_layout = QVBoxLayout()
        self.rows_layout.setContentsMargins(0, 0, 0, 0)
        self.rows_layout.setSpacing(6)
        self.rows_widget.setLayout(self.rows_layout)
        self.card_layout.addWidget(self.rows_widget)

        # Bottom Timestamp Row
        self.lbl_updated = QLabel("Loading data...")
        self.lbl_updated.setStyleSheet("color: #6b7280; font-size: 11px; font-weight: 500;")
        self.lbl_updated.installEventFilter(self)
        self.card_layout.addWidget(self.lbl_updated)

        # Setup Auto-refresh Timer
        self.timer = QTimer()
        self.timer.timeout.connect(self.fetch_data)
        interval = self.config.get("refresh_interval_minutes", 5)
        self.timer.start(interval * 60 * 1000)

    # Global event filter for dragging and click delegation
    def eventFilter(self, obj, event):
        if event.type() == QEvent.Type.MouseButtonPress:
            if event.button() == Qt.MouseButton.LeftButton:
                self.drag_start_pos = event.globalPosition().toPoint()
                self.dragged = False
                return False
        elif event.type() == QEvent.Type.MouseMove:
            if event.buttons() == Qt.MouseButton.LeftButton and not self.dragged:
                delta = event.globalPosition().toPoint() - self.drag_start_pos
                if delta.manhattanLength() > 5:
                    self.dragged = True
                    if self.window().windowHandle():
                        self.window().windowHandle().startSystemMove()
                        return True
        elif event.type() == QEvent.Type.MouseButtonRelease:
            if event.button() == Qt.MouseButton.LeftButton:
                if self.dragged:
                    self.dragged = False
                    return True
                self.dragged = False
        return super().eventFilter(obj, event)

    # Context menu triggers
    def contextMenuEvent(self, event):
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu {
                background-color: #0f172a;
                color: #f8fafc;
                border: 1px solid #1e293b;
                border-radius: 8px;
                padding: 4px;
            }
            QMenu::item {
                padding: 6px 20px;
                border-radius: 4px;
            }
            QMenu::item:selected {
                background-color: #2563eb;
                color: white;
            }
        """)

        action_refresh = menu.addAction("Refresh Now")
        action_settings = menu.addAction("Settings & Alerts...")
        
        # Always on Top checkbox action
        action_ontop = menu.addAction("Always on Top")
        action_ontop.setCheckable(True)
        action_ontop.setChecked(self.config.get("always_on_top", True))
        
        menu.addSeparator()
        action_close = menu.addAction("Close")

        # Execute Menu
        action = menu.exec(QCursor.pos())

        if action == action_refresh:
            self.fetch_data()
        elif action == action_settings:
            self.open_settings()
        elif action == action_ontop:
            val = action_ontop.isChecked()
            self.toggle_always_on_top(val)
        elif action == action_close:
            self.close()

    def toggle_always_on_top(self, active):
        self.config["always_on_top"] = active
        self.save_config()
        
        # Reset Window flags
        flags = Qt.WindowType.FramelessWindowHint | Qt.WindowType.Tool
        if active:
            flags |= Qt.WindowType.WindowStaysOnTopHint
        
        current_pos = self.pos()
        self.setWindowFlags(flags)
        self.move(current_pos)
        self.show() # Forces update of flags

    def open_settings(self):
        dialog = SettingsDialog(self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            self.save_config()
            
            # Re-apply window stays on top
            self.toggle_always_on_top(self.config["always_on_top"])
            
            # Restart timer
            self.timer.stop()
            interval = self.config.get("refresh_interval_minutes", 5)
            self.timer.start(interval * 60 * 1000)
            
            # Re-fetch
            self.fetch_data()

    # Trigger Background Data Fetch
    def fetch_data(self):
        self.lbl_status.setStyleSheet("color: #eab308; font-size: 12px;") # Yellow for fetching
        self.worker = FetchWorker()
        self.worker.finished.connect(self.on_fetch_complete)
        self.worker.start()

    def on_fetch_complete(self, data, error):
        if error:
            print("Fetch failed:", error)
            self.lbl_status.setStyleSheet("color: #ef4444; font-size: 12px;") # Red status dot
            self.lbl_updated.setText(f"Error loading. Offline.")
            return
        
        self.instruments = data
        self.lbl_status.setStyleSheet("color: #10b981; font-size: 12px;") # Green status dot
        
        # Update layout
        self.render_watchlist()
        self.check_alerts()

    # Draw watchlist rows dynamically
    def render_watchlist(self):
        # Clear rows layout
        while self.rows_layout.count():
            item = self.rows_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        watchlist = self.config.get("watchlist", [])
        if not watchlist:
            lbl = QLabel("Right-click to add stocks.")
            lbl.setStyleSheet("color: #6b7280; font-size: 11px; font-style: italic; padding: 10px 0;")
            self.rows_layout.addWidget(lbl)
            self.lbl_updated.setText("Watchlist empty.")
            return

        for symbol in watchlist:
            details = self.instruments.get(symbol)
            row_widget = StockRowWidget(symbol, details, self)
            row_widget.installEventFilter(self)
            self.rows_layout.addWidget(row_widget)

        # Update timestamp
        import datetime
        now = datetime.datetime.now().strftime("%I:%M %p")
        self.lbl_updated.setText(f"Updated at {now}")
        
        # Auto-adjust height to content size in the next tick
        QTimer.singleShot(0, self.adjustSize)

    # Validate active alerts
    def check_alerts(self):
        alerts = self.config.get("alerts", [])
        config_changed = False
        
        for alert in alerts:
            if alert.get("triggered", False):
                continue
                
            symbol = alert["symbol"]
            cond = alert["condition"]
            threshold = alert["value"]
            
            details = self.instruments.get(symbol)
            if not details:
                continue
                
            price = float(details.get("close", 0.0))
            
            # Validate threshold
            triggered = False
            if cond == "above" and price >= threshold:
                triggered = True
            elif cond == "below" and price <= threshold:
                triggered = True
                
            if triggered:
                alert["triggered"] = True
                config_changed = True
                msg_content = f"{symbol} is {cond} target {threshold:.2f}! Current: {price:.2f}"
                send_notification(
                    title=f"Stock Alert: {symbol}",
                    message=msg_content
                )
                if self.config.get("enable_google_chat", False) and self.config.get("google_chat_webhook_url"):
                    send_google_chat_notification(
                        self.config["google_chat_webhook_url"],
                        title=f"Stock Alert: {symbol}",
                        message=msg_content
                    )
                if self.config.get("enable_telegram", False) and self.config.get("telegram_bot_token") and self.config.get("telegram_chat_id"):
                    send_telegram_notification(
                        self.config["telegram_bot_token"],
                        self.config["telegram_chat_id"],
                        message=f"🔔 *Stock Alert: {symbol}*\n{msg_content}"
                    )
                
        if config_changed:
            self.save_config()

def main():
    import signal
    app = QApplication(sys.argv)
    
    # Allow Ctrl+C to terminate the application instantly in the terminal
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    
    # Heartbeat timer to periodically yield execution to Python for SIGINT processing
    sigint_timer = QTimer()
    sigint_timer.start(500)
    sigint_timer.timeout.connect(lambda: None)
    
    # Check if config directory exists
    config_dir = os.path.dirname(CONFIG_PATH)
    if config_dir:
        os.makedirs(config_dir, exist_ok=True)
        
    widget = StickyWidget()
    widget.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
