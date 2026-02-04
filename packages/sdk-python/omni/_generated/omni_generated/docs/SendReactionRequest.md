# SendReactionRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance ID | 
**to** | **str** | Chat ID | 
**message_id** | **str** | Message ID to react to | 
**emoji** | **str** | Emoji to react with | 

## Example

```python
from omni_generated.models.send_reaction_request import SendReactionRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SendReactionRequest from a JSON string
send_reaction_request_instance = SendReactionRequest.from_json(json)
# print the JSON string representation of the object
print(SendReactionRequest.to_json())

# convert the object into a dict
send_reaction_request_dict = send_reaction_request_instance.to_dict()
# create an instance of SendReactionRequest from a dict
send_reaction_request_from_dict = SendReactionRequest.from_dict(send_reaction_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


