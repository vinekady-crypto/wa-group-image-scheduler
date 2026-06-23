import os
import sys
import time
import json
import subprocess
from datetime import datetime, timedelta
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options

# Ensure tracking folders exist
os.makedirs('data', exist_ok=True)
os.makedirs('images', exist_ok=True)

STATUS_PATH = 'data/status.json'
LOG_PATH = 'data/run.log'
QR_PATH = 'data/qr.png'

def write_log(message):
    timestamp = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')
    log_entry = f"[{timestamp}] {message}\n"
    print(log_entry.strip())
    with open(LOG_PATH, 'a') as f:
        f.write(log_entry)

def update_status(status_type, message, extra_data=None):
    status = {
        "status": status_type,
        "message": message,
        "time": datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')
    }
    if extra_data:
        status.update(extra_data)
    with open(STATUS_PATH, 'w') as f:
        json.dump(status, f, indent=2)

def git_push_updates(files_to_commit, commit_message):
    """Commits and pushes updates directly from the runner back to the repository."""
    try:
        for file in files_to_commit:
            if os.path.exists(file):
                subprocess.run(["git", "add", file], check=True)
        
        status = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True)
        if status.stdout.strip():
            subprocess.run(["git", "commit", "-m", commit_message], check=True)
            subprocess.run(["git", "push"], check=True)
            print(f"Git commit/push success: {commit_message}")
    except Exception as e:
        print(f"Git command failed: {e}")

def get_chrome_driver():
    options = Options()
    options.add_argument('--headless=new')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--window-size=1920,1080')
    
    # Highly critical rendering options to prevent blank-page freezes in Linux containers
    options.add_argument('--disable-gpu')
    options.add_argument('--mute-audio')
    options.add_argument('--ignore-certificate-errors')
    options.add_argument('--allow-running-insecure-content')
    
    options.add_argument(f'--user-data-dir={os.path.abspath("./User_Data")}')  # Absolute path resolved
    
    # Modern 2026 Chrome user agent
    options.add_argument('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36')
    
    # Exclude automation flags to prevent anti-bot detection
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option('useAutomationExtension', False)
    
    driver = webdriver.Chrome(options=options)
    
    # Inject Chrome DevTools Protocol script to mask navigator.webdriver property completely
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
        "source": """
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            })
        """
    })
    
    return driver

def wait_for_login(driver, timeout_seconds=900):
    """Waits for login. If not logged in, exports QR and waits up to 15 minutes."""
    start_time = time.time()
    last_qr_update = 0
    qr_detected = False

    while time.time() - start_time < timeout_seconds:
        # Check if logged in (Presence of chat lists, compose box, side pane, or main chat list)
        try:
            driver.find_element(By.XPATH, '//div[@title="Search input textbox"] | //div[@contenteditable="true"][@data-tab="3"] | //div[@id="pane-side"] | //div[@data-testid="chat-list"]')
            write_log("Login verified successfully. Waiting 15 seconds for UI elements to fully settle...")
            time.sleep(15) # Safety buffer to ensure skeleton loaders are replaced by the real interactive input elements
            return True
        except:
            pass

        # Try to locate standard WhatsApp QR container
        try:
            qr_element = driver.find_element(By.CSS_SELECTOR, 'div[data-testid="qrcode"]')
            
            # Capture and push the zoomed QR element screenshot every 20 seconds to keep it fresh
            if time.time() - last_qr_update > 20:
                write_log("WhatsApp QR detected. Exporting zoomed element screenshot...")
                qr_element.screenshot(QR_PATH)
                update_status("waiting_qr", "Authentication required. Please scan the QR code on your dashboard.")
                git_push_updates([QR_PATH, STATUS_PATH], "Updated login QR code")
                last_qr_update = time.time()
                qr_detected = True
        except:
            # Fallback: if standard element isn't rendering yet, capture full page context
            if not qr_detected and (time.time() - start_time > 15) and (time.time() - last_qr_update > 30):
                write_log("Standard QR element not found yet. Capturing page state...")
                try:
                    # Try to capture main card container to keep the image centered
                    landing_container = driver.find_element(By.CSS_SELECTOR, 'div#app, body')
                    landing_container.screenshot(QR_PATH)
                except:
                    driver.save_screenshot(QR_PATH)
                
                update_status("waiting_qr", "Loading browser interface...")
                git_push_updates([QR_PATH, STATUS_PATH], "Captured fallback screenshot")
                last_qr_update = time.time()

        time.sleep(5)
    
    raise TimeoutError("WhatsApp login timed out or expired.")

def send_image(driver, group_name, img_path):
    write_log(f"Attempting to send image: {img_path} to group: {group_name}")
    
    # 1. Locate Search box using "presence" instead of "clickable" to bypass modal coordinate blocking
    search_box = WebDriverWait(driver, 20).until(
        EC.presence_of_element_located((By.XPATH, '//div[@title="Search input textbox"] | //div[@contenteditable="true"][@data-tab="3"] | //div[@contenteditable="true"]'))
    )
    
    # Click and Focus using direct browser JavaScript execution to completely bypass overlay blocking
    driver.execute_script("arguments[0].focus();", search_box)
    driver.execute_script("arguments[0].click();", search_box)
    time.sleep(2)
    
    # Clear using JS backspace simulation for safety
    search_box.send_keys(Keys.CONTROL + "a")
    search_box.send_keys(Keys.DELETE)
    time.sleep(1)
    
    # Type group name and hit enter
    for char in group_name:
        search_box.send_keys(char)
        time.sleep(0.05)
    search_box.send_keys(Keys.ENTER)
    time.sleep(3)

    # 2. Attach File
    file_input = WebDriverWait(driver, 15).until(
        EC.presence_of_element_located((By.XPATH, '//input[@type="file" and contains(@accept, "image")] | //input[@type="file"]'))
    )
    
    abs_path = os.path.abspath(img_path)
    if not os.path.exists(abs_path):
        raise FileNotFoundError(f"Image not found at path: {abs_path}")
        
    file_input.send_keys(abs_path)
    time.sleep(4)  # Wait for preview container to render

    # 3. Locate Send button in preview page and click it
    send_btn = WebDriverWait(driver, 15).until(
        EC.element_to_be_clickable((By.XPATH, '//span[@data-testid="send"] | //span[@data-icon="send"] | //div[@aria-label="Send"]'))
    )
    send_btn.click()
    
    # Wait to ensure message delivers
    time.sleep(6)
    write_log("Image sent successfully.")

def run_scheduler():
    write_log("Starting scheduler execution loop.")
    update_status("running", "Initializing browser environment...")
    git_push_updates([STATUS_PATH, LOG_PATH], "Started workflow initialization")

    driver = get_chrome_driver()
    
    try:
        driver.get("https://web.whatsapp.com")
        wait_for_login(driver)
        
        # Load the schedule configuration
        if not os.path.exists('data/schedule.json'):
            raise FileNotFoundError("Configuration file data/schedule.json not found.")

        with open('data/schedule.json', 'r') as f:
            config = json.load(f)

        group_name = config.get("group")
        items = config.get("items", [])
        
        if not group_name or not items:
            raise ValueError("Invalid group name or empty schedule list inside schedule.json.")

        completed_items = []
        
        for index, item in enumerate(items):
            target_time_str = item.get("time") # Expected format "HH:MM" (UTC)
            img_path = item.get("image")
            
            # Parse the scheduling target time
            now = datetime.utcnow()
            target_hour, target_min = map(int, target_time_str.split(':'))
            target_datetime = now.replace(hour=target_hour, minute=target_min, second=0, microsecond=0)

            # If the target time for today has already passed by more than 1 hour, schedule it for the next day.
            if now > target_datetime + timedelta(hours=1):
                target_datetime += timedelta(days=1)

            write_log(f"Image {index + 1} scheduled for: {target_datetime.strftime('%Y-%m-%d %H:%M UTC')}")

            # Keep alive sleep loop
            while datetime.utcnow() < target_datetime:
                remaining_secs = (target_datetime - datetime.utcnow()).total_seconds()
                # Print and commit state status updates every 15 minutes to avoid execution timeouts
                if remaining_secs > 900:
                    update_status("running", f"Waiting to send Image {index + 1}/{len(items)} at {target_time_str} UTC.", {
                        "next_image": img_path,
                        "next_time": target_time_str
                    })
                    git_push_updates([STATUS_PATH, LOG_PATH], f"Status check: Waiting for {target_time_str}")
                    time.sleep(900)
                else:
                    time.sleep(remaining_secs)

            # Fresh Connection Reload
            write_log("Re-establishing active connection before sending scheduled image...")
            driver.get("https://web.whatsapp.com")
            wait_for_login(driver)

            # Send action execution
            update_status("running", f"Sending scheduled Image {index + 1}/{len(items)} to group '{group_name}'...")
            git_push_updates([STATUS_PATH, LOG_PATH], f"Sending Image {index + 1}")
            
            send_image(driver, group_name, img_path)
            
            # Log Successful Send
            completed_items.append(img_path)
            write_log(f"Successfully sent scheduled Image {index + 1}/{len(items)}: {img_path}")
            update_status("running", f"Image {index + 1} sent.", {
                "last_sent": target_time_str,
                "last_sent_image": img_path,
                "completed_count": len(completed_items)
            })
            git_push_updates([STATUS_PATH, LOG_PATH], f"Successfully sent Image {index + 1}")

        # Finish campaign execution
        update_status("completed", "Campaign completed. All images sent successfully.")
        git_push_updates([STATUS_PATH, LOG_PATH], "All scheduled tasks completed successfully")

    except Exception as e:
        error_msg = str(e)
        error_type = type(e).__name__
        write_log(f"Exception encountered: {error_type} - {error_msg}")
        update_status("error", "An error halted execution.", {
            "error_type": error_type,
            "message": error_msg
        })
        git_push_updates([STATUS_PATH, LOG_PATH], "Execution stopped due to error")
        
    finally:
        driver.quit()
        write_log("Browser closed. Workflow execution complete.")

if __name__ == "__main__":
    run_scheduler()