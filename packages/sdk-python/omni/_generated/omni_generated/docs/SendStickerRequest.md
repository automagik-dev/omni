# SendStickerRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance ID | 
**to** | **str** | Recipient | 
**url** | **str** | Sticker URL | [optional] 
**var_base64** | **str** | Base64 encoded sticker | [optional] 

## Example

```python
from omni_generated.models.send_sticker_request import SendStickerRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SendStickerRequest from a JSON string
send_sticker_request_instance = SendStickerRequest.from_json(json)
# print the JSON string representation of the object
print(SendStickerRequest.to_json())

# convert the object into a dict
send_sticker_request_dict = send_sticker_request_instance.to_dict()
# create an instance of SendStickerRequest from a dict
send_sticker_request_from_dict = SendStickerRequest.from_dict(send_sticker_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


