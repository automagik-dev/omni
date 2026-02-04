# PresenceResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance ID | 
**chat_id** | **str** | Chat ID where presence was sent | 
**type** | **str** | Presence type sent | 
**duration** | **float** | Duration in ms | 

## Example

```python
from omni_generated.models.presence_response import PresenceResponse

# TODO update the JSON string below
json = "{}"
# create an instance of PresenceResponse from a JSON string
presence_response_instance = PresenceResponse.from_json(json)
# print the JSON string representation of the object
print(PresenceResponse.to_json())

# convert the object into a dict
presence_response_dict = presence_response_instance.to_dict()
# create an instance of PresenceResponse from a dict
presence_response_from_dict = PresenceResponse.from_dict(presence_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


