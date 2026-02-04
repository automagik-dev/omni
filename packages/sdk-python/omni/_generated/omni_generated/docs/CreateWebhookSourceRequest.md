# CreateWebhookSourceRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | Unique source name | 
**description** | **str** | Description | [optional] 
**expected_headers** | **Dict[str, bool]** | Headers to validate | [optional] 
**enabled** | **bool** | Whether enabled | [optional] [default to True]

## Example

```python
from omni_generated.models.create_webhook_source_request import CreateWebhookSourceRequest

# TODO update the JSON string below
json = "{}"
# create an instance of CreateWebhookSourceRequest from a JSON string
create_webhook_source_request_instance = CreateWebhookSourceRequest.from_json(json)
# print the JSON string representation of the object
print(CreateWebhookSourceRequest.to_json())

# convert the object into a dict
create_webhook_source_request_dict = create_webhook_source_request_instance.to_dict()
# create an instance of CreateWebhookSourceRequest from a dict
create_webhook_source_request_from_dict = CreateWebhookSourceRequest.from_dict(create_webhook_source_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


