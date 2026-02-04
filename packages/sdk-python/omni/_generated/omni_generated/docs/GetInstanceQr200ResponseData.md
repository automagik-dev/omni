# GetInstanceQr200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**qr** | **str** | QR code string | 
**expires_at** | **datetime** | QR code expiration | 
**message** | **str** | Status message | 

## Example

```python
from omni_generated.models.get_instance_qr200_response_data import GetInstanceQr200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of GetInstanceQr200ResponseData from a JSON string
get_instance_qr200_response_data_instance = GetInstanceQr200ResponseData.from_json(json)
# print the JSON string representation of the object
print(GetInstanceQr200ResponseData.to_json())

# convert the object into a dict
get_instance_qr200_response_data_dict = get_instance_qr200_response_data_instance.to_dict()
# create an instance of GetInstanceQr200ResponseData from a dict
get_instance_qr200_response_data_from_dict = GetInstanceQr200ResponseData.from_dict(get_instance_qr200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


