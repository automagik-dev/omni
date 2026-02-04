# SendPresence200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance ID | 
**chat_id** | **str** | Chat ID where presence was sent | 
**type** | **str** | Presence type sent | 
**duration** | **float** | Duration in ms | 

## Example

```python
from omni_generated.models.send_presence200_response_data import SendPresence200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of SendPresence200ResponseData from a JSON string
send_presence200_response_data_instance = SendPresence200ResponseData.from_json(json)
# print the JSON string representation of the object
print(SendPresence200ResponseData.to_json())

# convert the object into a dict
send_presence200_response_data_dict = send_presence200_response_data_instance.to_dict()
# create an instance of SendPresence200ResponseData from a dict
send_presence200_response_data_from_dict = SendPresence200ResponseData.from_dict(send_presence200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


