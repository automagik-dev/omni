# WebhookReceiveResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**event_id** | **UUID** | Created event ID | 
**source** | **str** | Webhook source name | 
**event_type** | **str** | Event type | 

## Example

```python
from omni_generated.models.webhook_receive_response import WebhookReceiveResponse

# TODO update the JSON string below
json = "{}"
# create an instance of WebhookReceiveResponse from a JSON string
webhook_receive_response_instance = WebhookReceiveResponse.from_json(json)
# print the JSON string representation of the object
print(WebhookReceiveResponse.to_json())

# convert the object into a dict
webhook_receive_response_dict = webhook_receive_response_instance.to_dict()
# create an instance of WebhookReceiveResponse from a dict
webhook_receive_response_from_dict = WebhookReceiveResponse.from_dict(webhook_receive_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


