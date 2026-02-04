# CreateWebhookSource201Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**ListWebhookSources200ResponseItemsInner**](ListWebhookSources200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.create_webhook_source201_response import CreateWebhookSource201Response

# TODO update the JSON string below
json = "{}"
# create an instance of CreateWebhookSource201Response from a JSON string
create_webhook_source201_response_instance = CreateWebhookSource201Response.from_json(json)
# print the JSON string representation of the object
print(CreateWebhookSource201Response.to_json())

# convert the object into a dict
create_webhook_source201_response_dict = create_webhook_source201_response_instance.to_dict()
# create an instance of CreateWebhookSource201Response from a dict
create_webhook_source201_response_from_dict = CreateWebhookSource201Response.from_dict(create_webhook_source201_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


