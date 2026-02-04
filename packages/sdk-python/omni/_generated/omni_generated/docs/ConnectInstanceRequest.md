# ConnectInstanceRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**token** | **str** | Bot token for Discord instances | [optional] 
**force_new_qr** | **bool** | Force new QR code for WhatsApp | [optional] 

## Example

```python
from omni_generated.models.connect_instance_request import ConnectInstanceRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ConnectInstanceRequest from a JSON string
connect_instance_request_instance = ConnectInstanceRequest.from_json(json)
# print the JSON string representation of the object
print(ConnectInstanceRequest.to_json())

# convert the object into a dict
connect_instance_request_dict = connect_instance_request_instance.to_dict()
# create an instance of ConnectInstanceRequest from a dict
connect_instance_request_from_dict = ConnectInstanceRequest.from_dict(connect_instance_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


