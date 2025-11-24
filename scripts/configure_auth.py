from huggingface_hub import HfApi
import sys
import argparse

def set_secret(space_id, key, value):
    print(f"🔐 Setting {key} for space {space_id}...")
    
    try:
        api = HfApi()
        api.add_space_secret(space_id, key, value)
        print(f"✅ Secret '{key}' set successfully!")
        print("🔄 The space should restart automatically.")
    except Exception as e:
        print(f"❌ Error setting secret: {e}")
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Set Hugging Face Space secret')
    parser.add_argument('--space', required=True, help='Space ID (e.g. username/space)')
    parser.add_argument('--key', required=True, help='Secret Key Name')
    parser.add_argument('--value', required=True, help='Secret Value')
    
    args = parser.parse_args()
    set_secret(args.space, args.key, args.value)
