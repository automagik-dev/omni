# SendPresenceRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance ID to send from | 
**to** | **str** | Chat ID to show presence in | 
**type** | **str** | Presence type | 
**duration** | **int** | Duration in ms before auto-pause (default 5000, 0 &#x3D; until paused) | [optional] [default to 5000]

## Example

```python
from omni_generated.models.send_presence_request import SendPresenceRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SendPresenceRequest from a JSON string
send_presence_request_instance = SendPresenceRequest.from_json(json)
# print the JSON string representation of the object
print(SendPresenceRequest.to_json())

# convert the object into a dict
send_presence_request_dict = send_presence_request_instance.to_dict()
# create an instance of SendPresenceRequest from a dict
send_presence_request_from_dict = SendPresenceRequest.from_dict(send_presence_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


